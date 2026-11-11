<?php
// HR interview tests: HR writes questions and answers; a candidate signs in with their email and an access code and takes the test.
// Mirrors server/src/controllers/tests.js.

const TEST_GRACE_SECONDS = 5; // slack for a slow network when the time runs out

function tst_options(array $q): array
{
    $o = json_decode((string) ($q['options'] ?? '[]'), true);
    return is_array($o) ? array_values($o) : [];
}

function tst_question(array $q): array
{
    return [
        'id' => (int) $q['id'], 'template_id' => (int) $q['template_id'], 'type' => $q['type'], 'question' => $q['question'], 'options' => tst_options($q),
        'correct_option' => $q['correct_option'] === null ? null : (int) $q['correct_option'], 'model_answer' => $q['model_answer'], 'marks' => (int) $q['marks'], 'sort_order' => (int) $q['sort_order'],
    ];
}

function tst_template(int $id): array
{
    $t = q_one('SELECT * FROM test_templates WHERE id = ?', [$id]);
    if (!$t) {
        throw new HttpError(404, 'Test not found');
    }
    return $t;
}

function tst_started(int $templateId): bool
{
    return (bool) q_one("SELECT id FROM test_attempts WHERE template_id = ? AND status != 'invited' LIMIT 1", [$templateId]);
}

function tst_assert_editable(int $templateId): void
{
    if (tst_started($templateId)) {
        throw new HttpError(409, 'Candidates have already taken this test, so its questions are locked. Use Duplicate to make a changed version.');
    }
}

function tst_template_input(bool $partial = false): array
{
    $v = new V(req_body());
    $d = [];
    $d['title'] = $v->str('title', 2, 120);
    $d['job_role'] = $v->optStr('job_role', 100);
    $d['industry'] = $v->optStr('industry', 100);
    $d['description'] = $v->optStr('description', 2000);
    $d['duration_minutes'] = (int) $v->num('duration_minutes', 1, 480);
    $d['pass_percent'] = (int) $v->num('pass_percent', 0, 100);
    $v->done();
    return $d;
}

function tst_list(): void
{
    $out = [];
    foreach (q_all('SELECT * FROM test_templates ORDER BY id DESC') as $t) {
        $id = (int) $t['id'];
        $out[] = $t + [
            'questions' => (int) q_val('SELECT COUNT(*) FROM test_questions WHERE template_id = ?', [$id]),
            'total_marks' => (int) q_val('SELECT COALESCE(SUM(marks), 0) FROM test_questions WHERE template_id = ?', [$id]),
            'candidates' => (int) q_val('SELECT COUNT(*) FROM test_attempts WHERE template_id = ?', [$id]),
        ];
    }
    respond(array_map(fn($t) => array_merge($t, ['id' => (int) $t['id'], 'duration_minutes' => (int) $t['duration_minutes'], 'pass_percent' => (int) $t['pass_percent']]), $out));
}

function tst_detail(array $p): void
{
    $t = tst_template((int) $p['id']);
    $qs = array_map('tst_question', q_all('SELECT * FROM test_questions WHERE template_id = ? ORDER BY sort_order, id', [$t['id']]));
    respond(array_merge($t, ['id' => (int) $t['id'], 'duration_minutes' => (int) $t['duration_minutes'], 'pass_percent' => (int) $t['pass_percent'], 'questions' => $qs, 'locked' => tst_started((int) $t['id'])]));
}

function tst_create(): void
{
    $d = tst_template_input();
    $id = q_insert('test_templates', $d + ['status' => 'active', 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts()]);
    audit('hr_test', $id, 'create', null, $d);
    respond(['id' => $id], 201);
}

function tst_update(array $p): void
{
    $t = tst_template((int) $p['id']);
    $in = req_body();
    $d = [];
    if (isset($in['title']) || isset($in['duration_minutes'])) {
        $d = tst_template_input();
    }
    if (isset($in['status'])) {
        if (!in_array($in['status'], ['active', 'archived'], true)) {
            throw new HttpError(400, 'Invalid status');
        }
        $d['status'] = $in['status'];
    }
    if ($d) {
        q_update('test_templates', $d + ['updated_at' => ts()], 'id = ?', [$t['id']]);
    }
    audit('hr_test', $t['id'], 'update', $t, $d);
    respond(['ok' => true]);
}

function tst_delete(array $p): void
{
    $t = tst_template((int) $p['id']);
    if (tst_started((int) $t['id'])) {
        throw new HttpError(409, 'Candidates have already taken this test. Archive it instead so their results are kept.');
    }
    q_run('DELETE FROM test_templates WHERE id = ?', [$t['id']]);
    audit('hr_test', $t['id'], 'delete', $t);
    no_content();
}

function tst_duplicate(array $p): void
{
    $t = tst_template((int) $p['id']);
    $id = q_insert('test_templates', [
        'title' => substr($t['title'] . ' (copy)', 0, 120), 'job_role' => $t['job_role'], 'industry' => $t['industry'], 'description' => $t['description'],
        'duration_minutes' => $t['duration_minutes'], 'pass_percent' => $t['pass_percent'], 'status' => 'active', 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    foreach (q_all('SELECT * FROM test_questions WHERE template_id = ? ORDER BY sort_order, id', [$t['id']]) as $q) {
        q_insert('test_questions', [
            'template_id' => $id, 'type' => $q['type'], 'question' => $q['question'], 'options' => $q['options'], 'correct_option' => $q['correct_option'],
            'model_answer' => $q['model_answer'], 'marks' => $q['marks'], 'sort_order' => $q['sort_order'],
        ]);
    }
    audit('hr_test', $id, 'duplicate', ['from' => $t['id']]);
    respond(['id' => $id], 201);
}

function tst_question_input(): array
{
    $in = req_body();
    $type = $in['type'] ?? '';
    if (!in_array($type, ['mcq', 'text'], true)) {
        throw new HttpError(400, 'Choose a question type');
    }
    $question = trim((string) ($in['question'] ?? ''));
    if (mb_strlen($question) < 3 || mb_strlen($question) > 2000) {
        throw new HttpError(400, 'Write the question (3 to 2000 characters)');
    }
    $marks = $in['marks'] ?? 1;
    if (!is_numeric($marks) || (int) $marks < 1 || (int) $marks > 100) {
        throw new HttpError(400, 'Marks must be between 1 and 100');
    }
    $row = ['type' => $type, 'question' => $question, 'marks' => (int) $marks, 'options' => null, 'correct_option' => null, 'model_answer' => null];
    if ($type === 'mcq') {
        $opts = is_array($in['options'] ?? null) ? array_values(array_map(fn($o) => trim((string) $o), $in['options'])) : [];
        if (count($opts) < 2 || count($opts) > 6 || in_array('', $opts, true)) {
            throw new HttpError(400, 'Add two to six options');
        }
        $c = $in['correct_option'] ?? null;
        if (!is_numeric($c) || (int) $c < 0 || (int) $c >= count($opts)) {
            throw new HttpError(400, 'Choose the correct option');
        }
        $row['options'] = json_encode($opts, JSON_UNESCAPED_UNICODE);
        $row['correct_option'] = (int) $c;
    } else {
        $m = trim((string) ($in['model_answer'] ?? ''));
        $row['model_answer'] = $m === '' ? null : mb_substr($m, 0, 3000);
    }
    return $row;
}

function tst_question_add(array $p): void
{
    $t = tst_template((int) $p['id']);
    tst_assert_editable((int) $t['id']);
    $row = tst_question_input();
    $last = (int) q_val('SELECT COALESCE(MAX(sort_order), 0) FROM test_questions WHERE template_id = ?', [$t['id']]);
    $id = q_insert('test_questions', $row + ['template_id' => $t['id'], 'sort_order' => $last + 1]);
    audit('hr_test_question', $id, 'create', null, ['template' => $t['id']]);
    respond(['id' => $id], 201);
}

function tst_question_update(array $p): void
{
    $q = q_one('SELECT * FROM test_questions WHERE id = ?', [(int) $p['qid']]);
    if (!$q) {
        throw new HttpError(404, 'Question not found');
    }
    tst_assert_editable((int) $q['template_id']);
    q_update('test_questions', tst_question_input(), 'id = ?', [$q['id']]);
    audit('hr_test_question', $q['id'], 'update');
    respond(['ok' => true]);
}

function tst_question_delete(array $p): void
{
    $q = q_one('SELECT * FROM test_questions WHERE id = ?', [(int) $p['qid']]);
    if (!$q) {
        throw new HttpError(404, 'Question not found');
    }
    tst_assert_editable((int) $q['template_id']);
    q_run('DELETE FROM test_questions WHERE id = ?', [$q['id']]);
    audit('hr_test_question', $q['id'], 'delete');
    no_content();
}

// ---------- Scoring ----------
function tst_round(float $n): float { return round($n * 100) / 100; }

// Recomputes totals from the saved marks. mcq answers are marked at submit; written answers wait for HR.
function tst_recalc(int $attemptId, array $extra = []): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [$attemptId]);
    $t = tst_template((int) $a['template_id']);
    $qs = q_all('SELECT * FROM test_questions WHERE template_id = ?', [$a['template_id']]);
    $ans = [];
    foreach (q_all('SELECT * FROM test_answers WHERE attempt_id = ?', [$a['id']]) as $x) {
        $ans[(int) $x['question_id']] = $x;
    }
    $total = 0;
    $score = 0.0;
    $pending = 0;
    foreach ($qs as $q) {
        $total += (int) $q['marks'];
        $x = $ans[(int) $q['id']] ?? null;
        if ($x && $x['marks_awarded'] !== null) {
            $score += (float) $x['marks_awarded'];
        }
        if ($q['type'] === 'text' && $x && trim((string) $x['answer_text']) !== '' && $x['marks_awarded'] === null) {
            $pending++;
        }
    }
    $percent = $total ? tst_round($score / $total * 100) : 0.0;
    $status = $extra['status'] ?? $a['status'];
    $result = $status !== 'submitted' ? null : ($pending > 0 ? 'review' : ($percent >= (int) $t['pass_percent'] ? 'pass' : 'fail'));
    q_update('test_attempts', ['total_marks' => $total, 'score' => tst_round($score), 'percent' => $percent, 'pending_review' => $pending, 'result' => $result, 'updated_at' => ts()] + $extra, 'id = ?', [$a['id']]);
}

function tst_finalize(int $attemptId): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [$attemptId]);
    if ($a['status'] === 'submitted') {
        return;
    }
    $ans = [];
    foreach (q_all('SELECT * FROM test_answers WHERE attempt_id = ?', [$a['id']]) as $x) {
        $ans[(int) $x['question_id']] = $x;
    }
    foreach (q_all('SELECT * FROM test_questions WHERE template_id = ?', [$a['template_id']]) as $q) {
        $x = $ans[(int) $q['id']] ?? null;
        $marks = null;
        if ($q['type'] === 'mcq') {
            $marks = $x && $x['selected_option'] !== null && (int) $x['selected_option'] === (int) $q['correct_option'] ? (int) $q['marks'] : 0;
        } elseif (!$x || trim((string) $x['answer_text']) === '') {
            $marks = 0;
        }
        if ($x) {
            q_update('test_answers', ['marks_awarded' => $marks], 'id = ?', [$x['id']]);
        } else {
            q_insert('test_answers', ['attempt_id' => $a['id'], 'question_id' => $q['id'], 'marks_awarded' => $marks]);
        }
    }
    tst_recalc((int) $a['id'], ['status' => 'submitted', 'submitted_at' => ts(), 'token' => null]);
}

function tst_seconds_left(array $a): int
{
    return (int) round(parse_ts($a['started_at']) + (int) $a['duration_minutes'] * 60 - time());
}
function tst_expired(array $a): bool
{
    return $a['status'] === 'in_progress' && tst_seconds_left($a) < -TEST_GRACE_SECONDS;
}

function tst_code(): string { return (string) random_int(100000, 999999); }

function tst_attempt_out(array $a, array $extra = []): array
{
    unset($a['token']);
    return array_merge($a, [
        'id' => (int) $a['id'], 'template_id' => (int) $a['template_id'], 'total_marks' => (float) $a['total_marks'], 'score' => (float) $a['score'], 'percent' => (float) $a['percent'],
        'pending_review' => (int) $a['pending_review'], 'duration_minutes' => (int) $a['duration_minutes'],
        'seconds_left' => $a['status'] === 'in_progress' ? max(0, tst_seconds_left($a)) : null,
    ], $extra);
}

// ---------- Candidates (HR) ----------
function tst_invite(): void
{
    $v = new V(req_body());
    $templateId = $v->int('template_id');
    $name = $v->str('name', 2, 120);
    $email = strtolower($v->email('email'));
    $phone = $v->optStr('phone', 30);
    $validOn = $v->has('valid_on') && $v->in['valid_on'] !== '' ? $v->date('valid_on') : today();
    $v->done();
    $t = tst_template($templateId);
    if ($t['status'] !== 'active') {
        throw new HttpError(400, 'This test is archived');
    }
    if (!q_one('SELECT id FROM test_questions WHERE template_id = ? LIMIT 1', [$t['id']])) {
        throw new HttpError(400, 'Add questions to this test first');
    }
    if ($validOn < today()) {
        throw new HttpError(400, 'The test date cannot be in the past');
    }
    do {
        $code = tst_code();
    } while (q_one('SELECT id FROM test_attempts WHERE lower(email) = ? AND access_code = ?', [$email, $code]));
    $id = q_insert('test_attempts', [
        'template_id' => $t['id'], 'name' => $name, 'email' => $email, 'phone' => $phone, 'access_code' => $code, 'valid_on' => $validOn, 'status' => 'invited',
        'duration_minutes' => $t['duration_minutes'], 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('hr_test_candidate', $id, 'invite', null, ['email' => $email, 'test' => $t['title']]);
    respond(['id' => $id, 'access_code' => $code, 'valid_on' => $validOn], 201);
}

function tst_candidates(): void
{
    $sql = 'SELECT a.*, t.title AS test_title, t.pass_percent FROM test_attempts a JOIN test_templates t ON t.id = a.template_id';
    $p = [];
    if (!empty($_GET['template_id'])) {
        $sql .= ' WHERE a.template_id = ?';
        $p[] = (int) $_GET['template_id'];
    }
    $sql .= ' ORDER BY a.id DESC LIMIT 300';
    $rows = q_all($sql, $p);
    $again = false;
    foreach ($rows as $a) {
        if (tst_expired($a)) { // a candidate who walked away: close the test and mark it
            tst_finalize((int) $a['id']);
            $again = true;
        }
    }
    if ($again) {
        $rows = q_all($sql, $p);
    }
    respond(array_map(fn($a) => tst_attempt_out($a, ['pass_percent' => (int) $a['pass_percent']]), $rows));
}

function tst_candidate_get(array $p): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [(int) $p['id']]);
    if (!$a) {
        throw new HttpError(404, 'Candidate not found');
    }
    if (tst_expired($a)) {
        tst_finalize((int) $a['id']);
        $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [$a['id']]);
    }
    $t = tst_template((int) $a['template_id']);
    $ans = [];
    foreach (q_all('SELECT * FROM test_answers WHERE attempt_id = ?', [$a['id']]) as $x) {
        $ans[(int) $x['question_id']] = $x;
    }
    $answers = [];
    foreach (q_all('SELECT * FROM test_questions WHERE template_id = ? ORDER BY sort_order, id', [$a['template_id']]) as $q) {
        $x = $ans[(int) $q['id']] ?? null;
        $answers[] = [
            'question' => tst_question($q), 'selected_option' => $x && $x['selected_option'] !== null ? (int) $x['selected_option'] : null,
            'answer_text' => $x['answer_text'] ?? null, 'marks_awarded' => $x && $x['marks_awarded'] !== null ? (float) $x['marks_awarded'] : null,
        ];
    }
    respond(tst_attempt_out($a, ['test_title' => $t['title'], 'pass_percent' => (int) $t['pass_percent'], 'answers' => $answers]));
}

function tst_candidate_update(array $p): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [(int) $p['id']]);
    if (!$a) {
        throw new HttpError(404, 'Candidate not found');
    }
    $in = req_body();
    $patch = [];
    if (array_key_exists('notes', $in)) {
        $patch['notes'] = $in['notes'] === null ? null : mb_substr((string) $in['notes'], 0, 3000);
    }
    if (!empty($in['valid_on'])) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $in['valid_on'])) {
            throw new HttpError(400, 'Use YYYY-MM-DD');
        }
        $patch['valid_on'] = $in['valid_on'];
    }
    $newCode = null;
    if (!empty($in['reset'])) {
        // Let the candidate sit the test again: wipe the answers and give a fresh code.
        $t = tst_template((int) $a['template_id']);
        q_run('DELETE FROM test_answers WHERE attempt_id = ?', [$a['id']]);
        $newCode = tst_code();
        $patch = array_merge($patch, [
            'status' => 'invited', 'token' => null, 'started_at' => null, 'submitted_at' => null, 'score' => 0, 'percent' => 0, 'pending_review' => 0, 'result' => null,
            'access_code' => $newCode, 'valid_on' => $patch['valid_on'] ?? today(), 'duration_minutes' => $t['duration_minutes'],
        ]);
    }
    if ($patch) {
        q_update('test_attempts', $patch + ['updated_at' => ts()], 'id = ?', [$a['id']]);
    }
    audit('hr_test_candidate', $a['id'], !empty($in['reset']) ? 'reset' : 'update');
    respond(['ok' => true, 'access_code' => $newCode]);
}

function tst_grade(array $p): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [(int) $p['id']]);
    if (!$a) {
        throw new HttpError(404, 'Candidate not found');
    }
    if ($a['status'] !== 'submitted') {
        throw new HttpError(400, 'The candidate has not submitted the test yet');
    }
    $marks = req_body()['marks'] ?? null;
    if (!is_array($marks)) {
        throw new HttpError(400, 'Send the marks to save');
    }
    foreach ($marks as $qid => $value) {
        $q = q_one('SELECT * FROM test_questions WHERE id = ? AND template_id = ?', [(int) $qid, $a['template_id']]);
        if (!$q || $q['type'] !== 'text') {
            throw new HttpError(400, 'Only written answers are marked by hand');
        }
        if (!is_numeric($value) || (float) $value < 0) {
            throw new HttpError(400, 'Marks must be zero or more');
        }
        if ((float) $value > (int) $q['marks']) {
            throw new HttpError(400, "Marks for a question cannot be more than {$q['marks']}");
        }
        $x = q_one('SELECT id FROM test_answers WHERE attempt_id = ? AND question_id = ?', [$a['id'], $q['id']]);
        if ($x) {
            q_update('test_answers', ['marks_awarded' => (float) $value], 'id = ?', [$x['id']]);
        } else {
            q_insert('test_answers', ['attempt_id' => $a['id'], 'question_id' => $q['id'], 'marks_awarded' => (float) $value]);
        }
    }
    tst_recalc((int) $a['id']);
    audit('hr_test_candidate', $a['id'], 'grade');
    respond(['ok' => true]);
}

function tst_candidate_delete(array $p): void
{
    $a = q_one('SELECT * FROM test_attempts WHERE id = ?', [(int) $p['id']]);
    if (!$a) {
        throw new HttpError(404, 'Candidate not found');
    }
    q_run('DELETE FROM test_attempts WHERE id = ?', [$a['id']]);
    audit('hr_test_candidate', $a['id'], 'delete', ['email' => $a['email']]);
    no_content();
}

// ---------- The candidate's own screens (no staff account: email + access code) ----------
function tst_candidate_from(): array
{
    $parts = explode('.', (string) ($_SERVER['HTTP_X_TEST_TOKEN'] ?? '')); // "companyId.token": the company part is read by tenant_resolve
    $token = (string) end($parts);
    if ($token === '') {
        throw new HttpError(401, 'Please sign in to the test');
    }
    $a = q_one('SELECT * FROM test_attempts WHERE token = ?', [$token]);
    if (!$a) {
        throw new HttpError(401, 'Your test session has ended. Please sign in again.');
    }
    if (tst_expired($a)) {
        tst_finalize((int) $a['id']);
        return q_one('SELECT * FROM test_attempts WHERE id = ?', [$a['id']]);
    }
    return $a;
}

function tst_candidate_login(): void
{
    $v = new V(req_body());
    $email = strtolower($v->email('email'));
    $code = $v->str('code', 4, 8);
    $v->done();
    if (!company()) {
        throw new HttpError(400, 'Enter the company code HR gave you');
    }
    // Wrong access codes are counted per company + email, so the 6-digit code cannot be guessed by trying them all.
    rl_limit('clogin:' . client_ip(), 30, 900, 'Too many attempts. Please wait a few minutes.');
    $failKey = 'code:' . company()['id'] . ':' . $email;
    if (rl_count($failKey) >= 8) {
        throw new HttpError(429, 'Too many wrong codes. Please ask HR for help, or try again in 15 minutes.');
    }
    $a = q_one('SELECT * FROM test_attempts WHERE lower(email) = ? AND access_code = ? ORDER BY id DESC LIMIT 1', [$email, $code]);
    if (!$a) {
        rl_hit($failKey, 900);
        throw new HttpError(401, 'We could not find that email and access code. Please check them or ask HR.');
    }
    if ($a['status'] === 'submitted') {
        throw new HttpError(403, 'You have already completed this test. Thank you.');
    }
    if (substr((string) $a['valid_on'], 0, 10) < today()) {
        throw new HttpError(403, 'This access code has expired. Please ask HR for a new one.');
    }
    if (tst_expired($a)) {
        tst_finalize((int) $a['id']);
        throw new HttpError(403, 'Your time for this test is over. Thank you.');
    }
    $token = bin2hex(random_bytes(24));
    q_update('test_attempts', ['token' => $token, 'updated_at' => ts()], 'id = ?', [$a['id']]);
    respond(['token' => company()['id'] . '.' . $token]);
}

function tst_candidate_session(): void
{
    $a = tst_candidate_from();
    $t = tst_template((int) $a['template_id']);
    $out = [
        'name' => $a['name'], 'status' => $a['status'],
        'test' => ['title' => $t['title'], 'description' => $t['description'], 'duration_minutes' => (int) $a['duration_minutes']],
        'question_count' => (int) q_val('SELECT COUNT(*) FROM test_questions WHERE template_id = ?', [$t['id']]),
        'total_marks' => (int) q_val('SELECT COALESCE(SUM(marks), 0) FROM test_questions WHERE template_id = ?', [$t['id']]),
    ];
    if ($a['status'] === 'in_progress') {
        $ans = [];
        foreach (q_all('SELECT * FROM test_answers WHERE attempt_id = ?', [$a['id']]) as $x) {
            $ans[(int) $x['question_id']] = $x;
        }
        $out['seconds_left'] = max(0, tst_seconds_left($a));
        $out['questions'] = array_map(function ($q) use ($ans) {
            $x = $ans[(int) $q['id']] ?? null;
            $row = ['id' => (int) $q['id'], 'type' => $q['type'], 'question' => $q['question'], 'marks' => (int) $q['marks'], 'selected_option' => $x && $x['selected_option'] !== null ? (int) $x['selected_option'] : null, 'answer_text' => $x['answer_text'] ?? ''];
            if ($q['type'] === 'mcq') {
                $row['options'] = tst_options($q);
            }
            return $row;
        }, q_all('SELECT * FROM test_questions WHERE template_id = ? ORDER BY sort_order, id', [$t['id']]));
    }
    respond($out);
}

function tst_candidate_start(): void
{
    $a = tst_candidate_from();
    if ($a['status'] === 'submitted') {
        throw new HttpError(400, 'This test is already submitted');
    }
    if ($a['status'] === 'invited') {
        $t = tst_template((int) $a['template_id']);
        q_update('test_attempts', ['status' => 'in_progress', 'started_at' => ts(), 'duration_minutes' => $t['duration_minutes'], 'updated_at' => ts()], 'id = ?', [$a['id']]);
    }
    respond(['ok' => true]);
}

function tst_save_answers(array $a, $answers): void
{
    if (!is_array($answers)) {
        return;
    }
    $qs = [];
    foreach (q_all('SELECT * FROM test_questions WHERE template_id = ?', [$a['template_id']]) as $q) {
        $qs[(int) $q['id']] = $q;
    }
    foreach (array_slice($answers, 0, 300) as $x) {
        $q = $qs[(int) ($x['question_id'] ?? 0)] ?? null;
        if (!$q) {
            continue;
        }
        if ($q['type'] === 'mcq') {
            $sel = $x['selected_option'] ?? null;
            $row = ['selected_option' => is_numeric($sel) && (int) $sel >= 0 && (int) $sel < count(tst_options($q)) ? (int) $sel : null];
        } else {
            $row = ['answer_text' => isset($x['answer_text']) ? mb_substr((string) $x['answer_text'], 0, 5000) : null];
        }
        $cur = q_one('SELECT id FROM test_answers WHERE attempt_id = ? AND question_id = ?', [$a['id'], $q['id']]);
        if ($cur) {
            q_update('test_answers', $row, 'id = ?', [$cur['id']]);
        } else {
            q_insert('test_answers', $row + ['attempt_id' => $a['id'], 'question_id' => $q['id']]);
        }
    }
}

function tst_candidate_save(): void
{
    $a = tst_candidate_from();
    if ($a['status'] !== 'in_progress') {
        throw new HttpError(400, $a['status'] === 'submitted' ? 'Your time is over and the test has been submitted' : 'Start the test first');
    }
    tst_save_answers($a, req_body()['answers'] ?? []);
    respond(['ok' => true, 'seconds_left' => max(0, tst_seconds_left($a))]);
}

function tst_candidate_submit(): void
{
    $a = tst_candidate_from();
    if ($a['status'] === 'in_progress') {
        tst_save_answers($a, req_body()['answers'] ?? null);
        tst_finalize((int) $a['id']);
    }
    respond(['ok' => true]);
}
