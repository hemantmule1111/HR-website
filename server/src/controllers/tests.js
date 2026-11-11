import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { ts, today, parseTs } from '../utils/dates.js';
import { dateStr } from '../utils/validators.js';

const r2 = (n) => Math.round(n * 100) / 100;
const parseOptions = (q) => { try { return JSON.parse(q.options || '[]'); } catch { return []; } };
const GRACE_SECONDS = 5; // slack for a slow network when the time runs out

// ---------- Question bank (HR) ----------
const templateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  job_role: z.string().trim().max(100).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  duration_minutes: z.coerce.number().int().min(1).max(480),
  pass_percent: z.coerce.number().int().min(0).max(100),
});

const questionSchema = z.object({
  type: z.enum(['mcq', 'text']),
  question: z.string().trim().min(3).max(2000),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6).optional(),
  correct_option: z.coerce.number().int().min(0).optional(),
  model_answer: z.string().trim().max(3000).optional().nullable(),
  marks: z.coerce.number().int().min(1).max(100).default(1),
}).superRefine((q, ctx) => {
  if (q.type === 'mcq') {
    if (!q.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two options' });
    else if (q.correct_option === undefined || q.correct_option >= q.options.length) ctx.addIssue({ code: 'custom', path: ['correct_option'], message: 'Choose the correct option' });
  }
});

const getTemplate = async (id) => {
  const t = await db('test_templates').where({ id }).first();
  if (!t) throw new HttpError(404, 'Test not found');
  return t;
};
const hasStarted = async (templateId) => !!(await db('test_attempts').where({ template_id: templateId }).whereNot({ status: 'invited' }).first());
const questionRow = (d) => ({
  type: d.type, question: d.question, marks: d.marks,
  options: d.type === 'mcq' ? JSON.stringify(d.options) : null,
  correct_option: d.type === 'mcq' ? d.correct_option : null,
  model_answer: d.type === 'text' ? d.model_answer || null : null,
});
const shapeQuestion = (q) => ({ ...q, options: parseOptions(q) });

export async function listTests(_req, res) {
  const rows = await db('test_templates').orderBy('id', 'desc');
  const qs = await db('test_questions').select('template_id').count({ n: 'id' }).sum({ marks: 'marks' }).groupBy('template_id');
  const at = await db('test_attempts').select('template_id').count({ n: 'id' }).groupBy('template_id');
  res.json(rows.map((t) => ({
    ...t,
    questions: Number(qs.find((x) => x.template_id === t.id)?.n || 0),
    total_marks: Number(qs.find((x) => x.template_id === t.id)?.marks || 0),
    candidates: Number(at.find((x) => x.template_id === t.id)?.n || 0),
  })));
}

export async function getTestDetail(req, res) {
  const t = await getTemplate(req.params.id);
  const questions = (await db('test_questions').where({ template_id: t.id }).orderBy('sort_order').orderBy('id')).map(shapeQuestion);
  res.json({ ...t, questions, locked: await hasStarted(t.id) });
}

export async function createTest(req, res) {
  const d = templateSchema.parse(req.body);
  const [id] = await db('test_templates').insert({ ...d, created_by: req.user.id });
  await audit(req, 'hr_test', id, 'create', null, d);
  res.status(201).json({ id });
}

export async function updateTest(req, res) {
  const t = await getTemplate(req.params.id);
  const d = templateSchema.extend({ status: z.enum(['active', 'archived']) }).partial().parse(req.body);
  await db('test_templates').where({ id: t.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'hr_test', t.id, 'update', t, d);
  res.json({ ok: true });
}

export async function deleteTest(req, res) {
  const t = await getTemplate(req.params.id);
  if (await hasStarted(t.id)) throw new HttpError(409, 'Candidates have already taken this test. Archive it instead so their results are kept.');
  await db('test_templates').where({ id: t.id }).del();
  await audit(req, 'hr_test', t.id, 'delete', t);
  res.status(204).end();
}

export async function duplicateTest(req, res) {
  const t = await getTemplate(req.params.id);
  const qs = await db('test_questions').where({ template_id: t.id }).orderBy('sort_order').orderBy('id');
  const { id: _i, created_at: _c, updated_at: _u, ...rest } = t;
  const [id] = await db('test_templates').insert({ ...rest, title: `${t.title} (copy)`.slice(0, 120), status: 'active', created_by: req.user.id });
  if (qs.length) await db('test_questions').insert(qs.map(({ id: _q, template_id: _t, ...q }) => ({ ...q, template_id: id })));
  await audit(req, 'hr_test', id, 'duplicate', { from: t.id });
  res.status(201).json({ id });
}

async function assertEditable(templateId) {
  if (await hasStarted(templateId)) throw new HttpError(409, 'Candidates have already taken this test, so its questions are locked. Use Duplicate to make a changed version.');
}

export async function addQuestion(req, res) {
  const t = await getTemplate(req.params.id);
  await assertEditable(t.id);
  const d = questionSchema.parse(req.body);
  const last = await db('test_questions').where({ template_id: t.id }).max({ m: 'sort_order' }).first();
  const [id] = await db('test_questions').insert({ ...questionRow(d), template_id: t.id, sort_order: Number(last?.m || 0) + 1 });
  await audit(req, 'hr_test_question', id, 'create', null, { template: t.id });
  res.status(201).json({ id });
}

export async function updateQuestion(req, res) {
  const q = await db('test_questions').where({ id: req.params.qid }).first();
  if (!q) throw new HttpError(404, 'Question not found');
  await assertEditable(q.template_id);
  const d = questionSchema.parse(req.body);
  await db('test_questions').where({ id: q.id }).update(questionRow(d));
  await audit(req, 'hr_test_question', q.id, 'update');
  res.json({ ok: true });
}

export async function deleteQuestion(req, res) {
  const q = await db('test_questions').where({ id: req.params.qid }).first();
  if (!q) throw new HttpError(404, 'Question not found');
  await assertEditable(q.template_id);
  await db('test_questions').where({ id: q.id }).del();
  await audit(req, 'hr_test_question', q.id, 'delete');
  res.status(204).end();
}

// ---------- Scoring ----------
// Recomputes totals from the saved marks. mcq answers are marked when the test is submitted; written answers wait for HR.
async function recalc(attemptId, extra = {}) {
  const a = await db('test_attempts').where({ id: attemptId }).first();
  const t = await db('test_templates').where({ id: a.template_id }).first();
  const qs = await db('test_questions').where({ template_id: a.template_id });
  const ans = await db('test_answers').where({ attempt_id: a.id });
  const total = qs.reduce((n, q) => n + q.marks, 0);
  const score = ans.reduce((n, x) => n + Number(x.marks_awarded || 0), 0);
  const pending = qs.filter((q) => q.type === 'text').filter((q) => {
    const x = ans.find((r) => r.question_id === q.id);
    return x && String(x.answer_text || '').trim() && x.marks_awarded === null;
  }).length;
  const percent = total ? r2((score / total) * 100) : 0;
  const submitted = (extra.status || a.status) === 'submitted';
  const result = !submitted ? null : pending > 0 ? 'review' : percent >= t.pass_percent ? 'pass' : 'fail';
  await db('test_attempts').where({ id: a.id }).update({ total_marks: total, score: r2(score), percent, pending_review: pending, result, ...extra, updated_at: db.fn.now() });
}

async function finalize(attemptId) {
  const a = await db('test_attempts').where({ id: attemptId }).first();
  if (a.status === 'submitted') return;
  const qs = await db('test_questions').where({ template_id: a.template_id });
  const ans = await db('test_answers').where({ attempt_id: a.id });
  for (const q of qs) {
    const x = ans.find((r) => r.question_id === q.id);
    const blank = !x || (q.type === 'mcq' ? x.selected_option === null : !String(x.answer_text || '').trim());
    let marks = null;
    if (q.type === 'mcq') marks = x && x.selected_option === q.correct_option ? q.marks : 0;
    else if (blank) marks = 0;
    if (x) await db('test_answers').where({ id: x.id }).update({ marks_awarded: marks });
    else await db('test_answers').insert({ attempt_id: a.id, question_id: q.id, marks_awarded: marks });
  }
  await recalc(a.id, { status: 'submitted', submitted_at: ts(), token: null });
}

const secondsLeft = (a) => Math.round((parseTs(a.started_at).getTime() + a.duration_minutes * 60000 - Date.now()) / 1000);
const expired = (a) => a.status === 'in_progress' && secondsLeft(a) < -GRACE_SECONDS;

// ---------- Candidates (HR) ----------
const inviteSchema = z.object({
  template_id: z.coerce.number().int(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: z.string().trim().max(30).optional().nullable(),
  valid_on: dateStr.optional(),
});

const newCode = () => String(crypto.randomInt(100000, 1000000));

export async function inviteCandidate(req, res) {
  const d = inviteSchema.parse(req.body);
  const t = await getTemplate(d.template_id);
  if (t.status !== 'active') throw new HttpError(400, 'This test is archived');
  if (!(await db('test_questions').where({ template_id: t.id }).first())) throw new HttpError(400, 'Add questions to this test first');
  const valid_on = d.valid_on || today();
  if (valid_on < today()) throw new HttpError(400, 'The test date cannot be in the past');
  let code = newCode();
  while (await db('test_attempts').whereRaw('lower(email) = ?', [d.email]).where({ access_code: code }).first()) code = newCode();
  const [id] = await db('test_attempts').insert({ template_id: t.id, name: d.name, email: d.email, phone: d.phone || null, access_code: code, valid_on, duration_minutes: t.duration_minutes, created_by: req.user.id });
  await audit(req, 'hr_test_candidate', id, 'invite', null, { email: d.email, test: t.title });
  res.status(201).json({ id, access_code: code, valid_on });
}

export async function listCandidates(req, res) {
  const q = db('test_attempts as a').join('test_templates as t', 't.id', 'a.template_id')
    .select('a.*', 't.title as test_title', 't.pass_percent').orderBy('a.id', 'desc').limit(300);
  if (req.query.template_id) q.where('a.template_id', Number(req.query.template_id));
  let rows = await q;
  for (const a of rows.filter(expired)) await finalize(a.id); // a candidate who walked away: close the test and mark it
  if (rows.some(expired)) rows = await q.clone();
  res.json(rows.map((a) => ({
    ...a, token: undefined, total_marks: Number(a.total_marks), score: Number(a.score), percent: Number(a.percent),
    seconds_left: a.status === 'in_progress' ? Math.max(0, secondsLeft(a)) : null,
  })));
}

export async function candidateDetail(req, res) {
  let a = await db('test_attempts').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Candidate not found');
  if (expired(a)) { await finalize(a.id); a = await db('test_attempts').where({ id: a.id }).first(); }
  const t = await getTemplate(a.template_id);
  const qs = (await db('test_questions').where({ template_id: a.template_id }).orderBy('sort_order').orderBy('id')).map(shapeQuestion);
  const ans = await db('test_answers').where({ attempt_id: a.id });
  res.json({
    ...a, token: undefined, total_marks: Number(a.total_marks), score: Number(a.score), percent: Number(a.percent), test_title: t.title, pass_percent: t.pass_percent,
    seconds_left: a.status === 'in_progress' ? Math.max(0, secondsLeft(a)) : null,
    answers: qs.map((q) => {
      const x = ans.find((r) => r.question_id === q.id);
      return { question: q, selected_option: x?.selected_option ?? null, answer_text: x?.answer_text ?? null, marks_awarded: x && x.marks_awarded !== null ? Number(x.marks_awarded) : null };
    }),
  });
}

export async function updateCandidate(req, res) {
  const a = await db('test_attempts').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Candidate not found');
  const d = z.object({ notes: z.string().max(3000).optional().nullable(), reset: z.boolean().optional(), valid_on: dateStr.optional() }).parse(req.body);
  const patch = {};
  if (d.notes !== undefined) patch.notes = d.notes;
  if (d.valid_on) patch.valid_on = d.valid_on;
  if (d.reset) {
    // Let the candidate sit the test again: wipe the answers and give a fresh code.
    const t = await getTemplate(a.template_id);
    await db('test_answers').where({ attempt_id: a.id }).del();
    Object.assign(patch, {
      status: 'invited', token: null, started_at: null, submitted_at: null, score: 0, percent: 0, pending_review: 0, result: null,
      access_code: newCode(), valid_on: d.valid_on || today(), duration_minutes: t.duration_minutes,
    });
  }
  await db('test_attempts').where({ id: a.id }).update({ ...patch, updated_at: db.fn.now() });
  await audit(req, 'hr_test_candidate', a.id, d.reset ? 'reset' : 'update');
  res.json({ ok: true, access_code: patch.access_code });
}

export async function gradeCandidate(req, res) {
  const a = await db('test_attempts').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Candidate not found');
  if (a.status !== 'submitted') throw new HttpError(400, 'The candidate has not submitted the test yet');
  const { marks } = z.object({ marks: z.record(z.string(), z.coerce.number().min(0)) }).parse(req.body);
  const qs = await db('test_questions').where({ template_id: a.template_id });
  for (const [qid, value] of Object.entries(marks)) {
    const q = qs.find((x) => x.id === Number(qid));
    if (!q || q.type !== 'text') throw new HttpError(400, 'Only written answers are marked by hand');
    if (value > q.marks) throw new HttpError(400, `Marks for a question cannot be more than ${q.marks}`);
    const x = await db('test_answers').where({ attempt_id: a.id, question_id: q.id }).first();
    if (x) await db('test_answers').where({ id: x.id }).update({ marks_awarded: value });
    else await db('test_answers').insert({ attempt_id: a.id, question_id: q.id, marks_awarded: value });
  }
  await recalc(a.id);
  await audit(req, 'hr_test_candidate', a.id, 'grade');
  res.json({ ok: true });
}

export async function deleteCandidate(req, res) {
  const a = await db('test_attempts').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Candidate not found');
  await db('test_attempts').where({ id: a.id }).del();
  await audit(req, 'hr_test_candidate', a.id, 'delete', { email: a.email });
  res.status(204).end();
}

// ---------- The candidate's own screens (no staff account: email + access code) ----------
async function candidateFrom(req) {
  const token = String(req.headers['x-test-token'] || '').split('.').pop(); // "companyId.token": the company part is read by resolveTenant
  if (!token) throw new HttpError(401, 'Please sign in to the test');
  const a = await db('test_attempts').where({ token }).first();
  if (!a) throw new HttpError(401, 'Your test session has ended. Please sign in again.');
  if (expired(a)) { await finalize(a.id); return db('test_attempts').where({ id: a.id }).first(); }
  return a;
}

// Wrong access codes are counted per company + email, so the 6-digit code cannot be guessed by trying them all.
const codeFails = new Map();
const CODE_MAX = 8;
const CODE_WINDOW = 15 * 60 * 1000;

export async function candidateLogin(req, res) {
  const { email, code } = z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().trim().min(4).max(8), company: z.string().optional() }).parse(req.body);
  if (!req.company) throw new HttpError(400, 'Enter the company code HR gave you');
  const key = `${req.company.id}:${email}`;
  const f = codeFails.get(key);
  if (f && f.n >= CODE_MAX && Date.now() - f.at < CODE_WINDOW) throw new HttpError(429, 'Too many wrong codes. Please ask HR for help, or try again in 15 minutes.');
  const a = await db('test_attempts').whereRaw('lower(email) = ?', [email]).where({ access_code: code }).orderBy('id', 'desc').first();
  if (!a) {
    codeFails.set(key, { n: (f && Date.now() - f.at < CODE_WINDOW ? f.n : 0) + 1, at: Date.now() });
    throw new HttpError(401, 'We could not find that email and access code. Please check them or ask HR.');
  }
  codeFails.delete(key);
  if (a.status === 'submitted') throw new HttpError(403, 'You have already completed this test. Thank you.');
  if (String(a.valid_on).slice(0, 10) < today()) throw new HttpError(403, 'This access code has expired. Please ask HR for a new one.');
  if (expired(a)) { await finalize(a.id); throw new HttpError(403, 'Your time for this test is over. Thank you.'); }
  const token = crypto.randomBytes(24).toString('hex');
  await db('test_attempts').where({ id: a.id }).update({ token, updated_at: db.fn.now() });
  res.json({ token: `${req.company.id}.${token}` });
}

export async function candidateSession(req, res) {
  const a = await candidateFrom(req);
  const t = await getTemplate(a.template_id);
  const out = {
    name: a.name, status: a.status, test: { title: t.title, description: t.description, duration_minutes: a.duration_minutes },
    question_count: (await db('test_questions').where({ template_id: t.id }).count({ n: 'id' }).first()).n,
  };
  out.question_count = Number(out.question_count);
  out.total_marks = Number((await db('test_questions').where({ template_id: t.id }).sum({ m: 'marks' }).first()).m || 0);
  if (a.status === 'in_progress') {
    const qs = await db('test_questions').where({ template_id: t.id }).orderBy('sort_order').orderBy('id');
    const ans = await db('test_answers').where({ attempt_id: a.id });
    out.seconds_left = Math.max(0, secondsLeft(a));
    out.questions = qs.map((q) => {
      const x = ans.find((r) => r.question_id === q.id);
      return { id: q.id, type: q.type, question: q.question, options: q.type === 'mcq' ? parseOptions(q) : undefined, marks: q.marks, selected_option: x?.selected_option ?? null, answer_text: x?.answer_text ?? '' };
    });
  }
  res.json(out);
}

export async function candidateStart(req, res) {
  const a = await candidateFrom(req);
  if (a.status === 'submitted') throw new HttpError(400, 'This test is already submitted');
  if (a.status === 'invited') {
    const t = await getTemplate(a.template_id);
    await db('test_attempts').where({ id: a.id }).update({ status: 'in_progress', started_at: ts(), duration_minutes: t.duration_minutes, updated_at: db.fn.now() });
  }
  res.json({ ok: true });
}

const answersSchema = z.object({
  answers: z.array(z.object({
    question_id: z.coerce.number().int(),
    selected_option: z.coerce.number().int().min(0).max(5).nullable().optional(),
    answer_text: z.string().max(5000).nullable().optional(),
  })).max(300),
});

async function saveAnswers(a, answers) {
  const qs = await db('test_questions').where({ template_id: a.template_id });
  for (const x of answers) {
    const q = qs.find((r) => r.id === x.question_id);
    if (!q) continue;
    const row = q.type === 'mcq'
      ? { selected_option: x.selected_option !== undefined && x.selected_option !== null && x.selected_option < parseOptions(q).length ? x.selected_option : null }
      : { answer_text: x.answer_text ?? null };
    const cur = await db('test_answers').where({ attempt_id: a.id, question_id: q.id }).first();
    if (cur) await db('test_answers').where({ id: cur.id }).update(row);
    else await db('test_answers').insert({ attempt_id: a.id, question_id: q.id, ...row });
  }
}

export async function candidateSave(req, res) {
  const a = await candidateFrom(req);
  if (a.status !== 'in_progress') throw new HttpError(400, a.status === 'submitted' ? 'Your time is over and the test has been submitted' : 'Start the test first');
  await saveAnswers(a, answersSchema.parse(req.body).answers);
  res.json({ ok: true, seconds_left: Math.max(0, secondsLeft(a)) });
}

export async function candidateSubmit(req, res) {
  const a = await candidateFrom(req);
  if (a.status === 'in_progress') {
    const { answers } = answersSchema.partial().parse(req.body || {});
    if (answers) await saveAnswers(a, answers);
    await finalize(a.id);
  }
  res.json({ ok: true });
}
