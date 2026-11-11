import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getCompany } from '../api'
import Icon from '../ui/Icon'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { fmtDate } from '../ui/format'

const candidateUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}candidate-test${getCompany() ? `?c=${encodeURIComponent(getCompany())}` : ''}`
const copy = (text, toast) => { navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Could not copy. Select the text and copy it.', 'error')) }
const STATUS = { invited: ['gray', 'Not started'], in_progress: ['blue', 'Taking the test'], submitted: ['green', 'Submitted'] }
const RESULT = { pass: ['green', 'Pass'], fail: ['red', 'Fail'], review: ['amber', 'Needs marking'] }
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const todayStr = () => new Date().toISOString().slice(0, 10)

// ---------- Test form (create / edit settings) ----------
function TestForm({ test, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ title: test?.title || '', job_role: test?.job_role || '', industry: test?.industry || '', description: test?.description || '', duration_minutes: test?.duration_minutes || 30, pass_percent: test?.pass_percent ?? 50 })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => api(test ? `/tests/${test.id}` : '/tests', { method: test ? 'PATCH' : 'POST', body: { ...f, duration_minutes: Number(f.duration_minutes), pass_percent: Number(f.pass_percent) } }),
    onSuccess: (r) => { toast(test ? 'Test updated' : 'Test created. Now add the questions.'); onSaved(r) },
  })
  return (
    <Modal title={test ? 'Test settings' : 'New test'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Test name" span={2}><input className="input" required minLength={2} value={f.title} onChange={set('title')} placeholder="e.g. Accounts Executive screening" /></Field>
        <Field label="Job role"><input className="input" value={f.job_role} onChange={set('job_role')} placeholder="e.g. Accounts Executive" /></Field>
        <Field label="Industry"><input className="input" value={f.industry} onChange={set('industry')} placeholder="e.g. Manufacturing" /></Field>
        <Field label="Time allowed (minutes)"><input className="input" type="number" min="1" max="480" required value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
        <Field label="Pass mark (%)"><input className="input" type="number" min="0" max="100" required value={f.pass_percent} onChange={set('pass_percent')} /></Field>
        <Field label="Instructions for the candidate" span={2}><textarea className="input" value={f.description} onChange={set('description')} placeholder="Shown before the test starts" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>{test ? 'Save' : 'Create test'}</Button></div>
      </form>
    </Modal>
  )
}

// ---------- Tests tab ----------
function TestsList() {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [adding, setAdding] = useState(false)
  const [del, setDel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['hrtests', 'list'], queryFn: () => api('/tests') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['hrtests'] })
  const dup = useMutation({ mutationFn: (id) => api(`/tests/${id}/duplicate`, { method: 'POST' }), onSuccess: (r) => { toast('Copied. Edit the new test as needed.'); refresh(); nav(`/tests/${r.id}`) }, onError: (e) => toast(e.message, 'error') })
  const arch = useMutation({ mutationFn: (t) => api(`/tests/${t.id}`, { method: 'PATCH', body: { status: t.status === 'active' ? 'archived' : 'active' } }), onSuccess: refresh, onError: (e) => toast(e.message, 'error') })
  const rm = useMutation({ mutationFn: (id) => api(`/tests/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Test deleted'); refresh() }, onError: (e) => toast(e.message, 'error') })
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}><Button icon="plus" onClick={() => setAdding(true)}>New test</Button></div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No tests yet" hint="Create a test for a job role, then add your questions and answers." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Test</th><th>Role / industry</th><th className="num">Questions</th><th className="num">Marks</th><th className="num">Time</th><th className="num">Pass</th><th className="num">Candidates</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((t) => (
              <tr key={t.id}>
                <td><Link to={`/tests/${t.id}`}><b>{t.title}</b></Link></td>
                <td>{[t.job_role, t.industry].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{t.questions}</td><td className="num">{t.total_marks}</td><td className="num">{t.duration_minutes} min</td><td className="num">{t.pass_percent}%</td><td className="num">{t.candidates}</td>
                <td><Badge tone={t.status === 'active' ? 'green' : 'gray'}>{t.status === 'active' ? 'Active' : 'Archived'}</Badge></td>
                <td><div className="row-actions">
                  <Button variant="light" className="sm" onClick={() => nav(`/tests/${t.id}`)}>Questions</Button>
                  <Button variant="ghost" className="sm" onClick={() => dup.mutate(t.id)}>Duplicate</Button>
                  <Button variant="ghost" className="sm" onClick={() => arch.mutate(t)}>{t.status === 'active' ? 'Archive' : 'Activate'}</Button>
                  <Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(t)}>Delete</Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {adding && <TestForm onClose={() => setAdding(false)} onSaved={(r) => { setAdding(false); refresh(); nav(`/tests/${r.id}`) }} />}
      {del && <Confirm danger title="Delete this test?" message={`${del.title} and its questions will be removed.`} confirmLabel="Delete" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

// ---------- Candidates tab ----------
function InviteModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: tests = [] } = useQuery({ queryKey: ['hrtests', 'list'], queryFn: () => api('/tests') })
  const ready = tests.filter((t) => t.status === 'active' && t.questions > 0)
  const [f, setF] = useState({ template_id: '', name: '', email: '', phone: '', valid_on: todayStr() })
  const [done, setDone] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => api('/test-candidates', { method: 'POST', body: { ...f, template_id: Number(f.template_id || ready[0]?.id), phone: f.phone || undefined } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['hrtests'] }); setDone(r) },
  })
  if (done) return <Access title="Candidate is ready" email={f.email.toLowerCase()} code={done.access_code} validOn={done.valid_on} onClose={onClose} />
  return (
    <Modal title="Add a candidate" onClose={onClose}>
      {!ready.length ? <p className="muted">Create a test and add at least one question first.</p> : (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
          <Field label="Test" span={2}><select className="select" value={f.template_id || ready[0].id} onChange={set('template_id')}>{ready.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.questions} questions, {t.duration_minutes} min)</option>)}</select></Field>
          <Field label="Candidate name"><input className="input" required minLength={2} value={f.name} onChange={set('name')} /></Field>
          <Field label="Candidate email" hint="The candidate signs in with this email"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field>
          <Field label="Phone (optional)"><input className="input" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Test date" hint="The access code works on this day"><input className="input" type="date" required min={todayStr()} value={f.valid_on} onChange={set('valid_on')} /></Field>
          {m.error && <p className="form-error span-2">{m.error.message}</p>}
          <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Create access code</Button></div>
        </form>
      )}
    </Modal>
  )
}

function Access({ title, email, code, validOn, onClose }) {
  const toast = useToast()
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginBottom: '1rem' }}>Give these to the candidate. They open the test page on the office computer and sign in with them{validOn ? ` on ${fmtDate(validOn)}` : ''}.</p>
      <div className="access-box">
        <div><small>Test page</small><b>{candidateUrl()}</b><Button variant="ghost" className="sm" onClick={() => copy(candidateUrl(), toast)}>Copy</Button></div>
        <div><small>Email</small><b>{email}</b><Button variant="ghost" className="sm" onClick={() => copy(email, toast)}>Copy</Button></div>
        <div><small>Access code</small><b className="access-code">{code}</b><Button variant="ghost" className="sm" onClick={() => copy(code, toast)}>Copy</Button></div>
      </div>
      <div className="form-actions"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  )
}

function Result({ id, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: c, isLoading } = useQuery({ queryKey: ['hrtests', 'candidate', id], queryFn: () => api(`/test-candidates/${id}`), refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 5000 : false) })
  const [marks, setMarks] = useState({})
  const [notes, setNotes] = useState(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['hrtests'] }); setMarks({}) }
  const grade = useMutation({ mutationFn: () => api(`/test-candidates/${id}/grade`, { method: 'POST', body: { marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Number(v)])) } }), onSuccess: () => { toast('Marks saved'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const saveNotes = useMutation({ mutationFn: () => api(`/test-candidates/${id}`, { method: 'PATCH', body: { notes } }), onSuccess: () => { toast('Notes saved'); refresh() }, onError: (e) => toast(e.message, 'error') })
  return (
    <Modal wide title={c ? `${c.name}: ${c.test_title}` : 'Result'} onClose={onClose}>
      {isLoading || !c ? <Loading /> : (
        <>
          <div className="result-sum">
            <div><small>Email</small><b>{c.email}</b></div>
            <div><small>Status</small><Badge tone={STATUS[c.status][0]}>{STATUS[c.status][1]}{c.status === 'in_progress' ? ` · ${mmss(c.seconds_left)} left` : ''}</Badge></div>
            {c.status === 'submitted' && <><div><small>Score</small><b>{c.score} / {c.total_marks} ({c.percent}%)</b></div><div><small>Result</small><Badge tone={RESULT[c.result][0]}>{RESULT[c.result][1]}</Badge><small className="muted"> pass mark {c.pass_percent}%</small></div></>}
          </div>
          {c.status === 'submitted' ? (
            <ol className="result-list">
              {c.answers.map(({ question: q, selected_option: sel, answer_text: txt, marks_awarded: got }) => (
                <li key={q.id}>
                  <p><b>{q.question}</b> <small className="muted">({q.marks} mark{q.marks === 1 ? '' : 's'})</small></p>
                  {q.type === 'mcq' ? (
                    <ul className="opts">{q.options.map((o, i) => <li key={i} className={`${i === q.correct_option ? 'right' : ''} ${i === sel ? 'chosen' : ''}`}>{i === q.correct_option ? '✓ ' : i === sel ? '✗ ' : ''}{o}{i === sel && <small> (candidate's answer)</small>}</li>)}{sel === null && <li className="muted">Not answered</li>}</ul>
                  ) : (
                    <>
                      <blockquote className={txt ? '' : 'muted'}>{txt || 'Not answered'}</blockquote>
                      {q.model_answer && <p className="muted"><small>Model answer: {q.model_answer}</small></p>}
                    </>
                  )}
                  <p className="mark-line">
                    {q.type === 'mcq' ? <span>Marks: <b>{got ?? 0}</b> / {q.marks}</span> : (
                      <span>Marks: <input className="input mark-input" type="number" min="0" max={q.marks} step="1" value={marks[q.id] ?? got ?? ''} placeholder="—" disabled={!txt} onChange={(e) => setMarks({ ...marks, [q.id]: e.target.value })} /> / {q.marks}{txt && got === null && marks[q.id] === undefined && <Badge tone="amber">needs marking</Badge>}</span>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          ) : <p className="muted" style={{ margin: '1rem 0' }}>{c.status === 'in_progress' ? 'The candidate is taking the test now. This page updates by itself.' : 'The candidate has not started the test yet.'}</p>}
          <Field label="Interview notes (only HR can see this)"><textarea className="input" value={notes ?? c.notes ?? ''} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="form-actions">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="light" disabled={notes === null} busy={saveNotes.isPending} onClick={() => saveNotes.mutate()}>Save notes</Button>
            {c.status === 'submitted' && <Button disabled={!Object.keys(marks).length} busy={grade.isPending} onClick={() => grade.mutate()}>Save marks</Button>}
          </div>
        </>
      )}
    </Modal>
  )
}

function Candidates() {
  const toast = useToast()
  const qc = useQueryClient()
  const [inviting, setInviting] = useState(false)
  const [view, setView] = useState(null)
  const [reset, setReset] = useState(null)
  const [code, setCode] = useState(null)
  const [del, setDel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['hrtests', 'candidates'], queryFn: () => api('/test-candidates'), refetchInterval: 8000 })
  const refresh = () => qc.invalidateQueries({ queryKey: ['hrtests'] })
  const re = useMutation({ mutationFn: (c) => api(`/test-candidates/${c.id}`, { method: 'PATCH', body: { reset: true } }), onSuccess: (r, c) => { refresh(); setCode({ ...c, access_code: r.access_code }) }, onError: (e) => toast(e.message, 'error') })
  const rm = useMutation({ mutationFn: (id) => api(`/test-candidates/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Candidate removed'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const live = data.filter((c) => c.status === 'in_progress').length
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <span className="muted">{live ? `${live} candidate${live === 1 ? ' is' : 's are'} taking a test right now` : 'Results appear here as soon as a candidate submits.'}</span>
        <Button icon="plus" onClick={() => setInviting(true)}>Add a candidate</Button>
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="users" title="No candidates yet" hint="Add a candidate, then give them the email and access code." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Candidate</th><th>Test</th><th>Test date</th><th>Status</th><th className="num">Score</th><th>Result</th><th /></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><small className="muted" style={{ display: 'block' }}>{c.email}</small></td>
                <td>{c.test_title}</td>
                <td className="nowrap">{fmtDate(c.valid_on)}</td>
                <td><Badge tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>{c.status === 'in_progress' && <small className="muted" style={{ display: 'block' }}>{mmss(c.seconds_left)} left</small>}</td>
                <td className="num">{c.status === 'submitted' ? `${c.score} / ${c.total_marks} (${c.percent}%)` : '—'}</td>
                <td>{c.result ? <Badge tone={RESULT[c.result][0]}>{RESULT[c.result][1]}</Badge> : '—'}</td>
                <td><div className="row-actions">
                  <Button variant="light" className="sm" icon="eye" onClick={() => setView(c.id)}>{c.status === 'submitted' ? 'Result' : 'Open'}</Button>
                  <Button variant="ghost" className="sm" onClick={() => setReset(c)}>{c.status === 'invited' ? 'New code' : 'Re-test'}</Button>
                  <Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(c)}>Remove</Button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {view && <Result id={view} onClose={() => setView(null)} />}
      {reset && <Confirm title={reset.status === 'invited' ? 'Make a new access code?' : 'Let this candidate take the test again?'} message={reset.status === 'invited' ? `${reset.name} gets a new code, valid today.` : `${reset.name}'s answers and score are cleared and a new access code is made, valid today.`} confirmLabel="Continue" onConfirm={() => re.mutate(reset)} onClose={() => setReset(null)} />}
      {code && <Access title="New access code" email={code.email} code={code.access_code} validOn={todayStr()} onClose={() => setCode(null)} />}
      {del && <Confirm danger title="Remove this candidate?" message={`${del.name}'s test and result are deleted.`} confirmLabel="Remove" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

export default function HrTests() {
  const [tab, setTab] = useState('candidates')
  return (
    <>
      <PageHeader title="HR tests" subtitle="Set questions and answers for a job role, then test candidates in the office">
        <a className="btn light" href={candidateUrl()} target="_blank" rel="noreferrer"><Icon name="right" size={16} />Open candidate test page</a>
      </PageHeader>
      <Tabs tabs={[{ id: 'candidates', label: 'Candidates & results' }, { id: 'tests', label: 'Tests & questions' }]} value={tab} onChange={setTab} />
      {tab === 'candidates' ? <Candidates /> : <TestsList />}
    </>
  )
}

// ---------- Question editor ----------
const blankQ = { type: 'mcq', question: '', options: ['', '', '', ''], correct_option: 0, model_answer: '', marks: 1 }

function QuestionForm({ testId, q, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(q ? { ...blankQ, ...q, model_answer: q.model_answer || '', options: q.type === 'mcq' ? q.options : blankQ.options } : blankQ)
  const m = useMutation({
    mutationFn: () => {
      const body = f.type === 'mcq'
        ? { type: 'mcq', question: f.question, options: f.options.map((o) => o.trim()).filter(Boolean), correct_option: f.options.slice(0, f.correct_option).filter((o) => o.trim()).length, marks: Number(f.marks) }
        : { type: 'text', question: f.question, model_answer: f.model_answer, marks: Number(f.marks) }
      if (f.type === 'mcq' && !f.options[f.correct_option]?.trim()) throw new Error('Choose a correct option that is not empty')
      return api(q ? `/tests/questions/${q.id}` : `/tests/${testId}/questions`, { method: q ? 'PATCH' : 'POST', body })
    },
    onSuccess: () => { toast(q ? 'Question updated' : 'Question added'); qc.invalidateQueries({ queryKey: ['hrtests'] }); onClose() },
  })
  const setOpt = (i, v) => setF({ ...f, options: f.options.map((o, n) => (n === i ? v : o)) })
  return (
    <Modal wide title={q ? 'Edit question' : 'Add a question'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Type" span={2}><select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="mcq">Multiple choice (marked automatically)</option><option value="text">Written answer (HR marks it)</option></select></Field>
        <Field label="Question" span={2}><textarea className="input" required minLength={3} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} /></Field>
        {f.type === 'mcq' ? (
          <div className="span-2 opt-edit" style={{ gridColumn: 'span 2' }}>
            <small className="muted">Type the options and tick the correct one.</small>
            {f.options.map((o, i) => (
              <div key={i} className="opt-row">
                <input type="radio" name="correct" aria-label={`Option ${i + 1} is correct`} checked={f.correct_option === i} onChange={() => setF({ ...f, correct_option: i })} />
                <input className="input" placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpt(i, e.target.value)} />
                {f.options.length > 2 && <Button variant="ghost" type="button" className="sm" icon="x" aria-label="Remove option" onClick={() => setF({ ...f, options: f.options.filter((_, n) => n !== i), correct_option: f.correct_option === i ? 0 : f.correct_option > i ? f.correct_option - 1 : f.correct_option })} />}
              </div>
            ))}
            {f.options.length < 6 && <Button variant="ghost" type="button" className="sm" icon="plus" onClick={() => setF({ ...f, options: [...f.options, ''] })}>Add option</Button>}
          </div>
        ) : <Field label="Model answer (only HR sees it)" span={2}><textarea className="input" value={f.model_answer} onChange={(e) => setF({ ...f, model_answer: e.target.value })} placeholder="What a good answer should cover" /></Field>}
        <Field label="Marks"><input className="input" type="number" min="1" max="100" required value={f.marks} onChange={(e) => setF({ ...f, marks: e.target.value })} /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>{q ? 'Save question' : 'Add question'}</Button></div>
      </form>
    </Modal>
  )
}

export function TestEditor() {
  const { id } = useParams()
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // null | 'new' | question
  const [settings, setSettings] = useState(false)
  const [del, setDel] = useState(null)
  const { data: t, isLoading, error } = useQuery({ queryKey: ['hrtests', 'detail', id], queryFn: () => api(`/tests/${id}`) })
  const rm = useMutation({ mutationFn: (qid) => api(`/tests/questions/${qid}`, { method: 'DELETE' }), onSuccess: () => { toast('Question removed'); qc.invalidateQueries({ queryKey: ['hrtests'] }) }, onError: (e) => toast(e.message, 'error') })
  if (isLoading) return <Loading />
  if (error) return <Card><Empty icon="file" title="Test not found" hint={error.message} /></Card>
  const total = t.questions.reduce((n, q) => n + q.marks, 0)
  return (
    <>
      <PageHeader title={t.title} subtitle={`${[t.job_role, t.industry].filter(Boolean).join(' · ') || 'HR test'} · ${t.duration_minutes} min · pass mark ${t.pass_percent}% · ${t.questions.length} question${t.questions.length === 1 ? '' : 's'}, ${total} marks`}>
        <Link className="btn ghost" to="/tests"><Icon name="left" size={16} />All tests</Link>
        <Button variant="light" onClick={() => setSettings(true)}>Test settings</Button>
        <Button icon="plus" disabled={t.locked} onClick={() => setEditing('new')}>Add question</Button>
      </PageHeader>
      {t.locked && <p className="muted" style={{ marginBottom: '1rem' }}>Candidates have already taken this test, so its questions are locked. Use Duplicate on the Tests page to make a changed version.</p>}
      {!t.questions.length ? <Card><Empty icon="file" title="No questions yet" hint="Add multiple choice questions (marked automatically) or written ones (you mark them)." /></Card> : (
        <div className="grid" style={{ gap: '1rem' }}>
          {t.questions.map((q, n) => (
            <Card key={q.id}>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <p><b>{n + 1}. {q.question}</b> <Badge tone={q.type === 'mcq' ? 'blue' : 'violet'}>{q.type === 'mcq' ? 'Multiple choice' : 'Written'}</Badge> <small className="muted">{q.marks} mark{q.marks === 1 ? '' : 's'}</small></p>
                  {q.type === 'mcq' ? <ul className="opts">{q.options.map((o, i) => <li key={i} className={i === q.correct_option ? 'right' : ''}>{i === q.correct_option ? '✓ ' : ''}{o}</li>)}</ul>
                    : <p className="muted" style={{ marginTop: '.4rem' }}>{q.model_answer ? `Model answer: ${q.model_answer}` : 'No model answer added.'}</p>}
                </div>
                {!t.locked && <div className="row-actions"><Button variant="ghost" className="sm" icon="edit" onClick={() => setEditing(q)}>Edit</Button><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(q)}>Delete</Button></div>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <QuestionForm testId={t.id} q={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {settings && <TestForm test={t} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); qc.invalidateQueries({ queryKey: ['hrtests'] }) }} />}
      {del && <Confirm danger title="Delete this question?" message={del.question} confirmLabel="Delete" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}
