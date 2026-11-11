<?php
// Employees, their documents and employment history.

const SENSITIVE = ['bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar'];

function emp_spec(bool $create): array
{
    $spec = [
        'first_name' => [fn($v, $k) => $v->str($k, 1, 80), true],
        'last_name' => [fn($v, $k) => $v->str($k, 0, 80), false, ''],
        'email' => [fn($v, $k) => $v->email($k), true],
        'phone' => [fn($v, $k) => $v->optStr($k, 30), false],
        'dob' => [fn($v, $k) => $v->optDate($k), false],
        'gender' => [fn($v, $k) => $v->optEnum($k, ['male', 'female', 'other']), false],
        'address' => [fn($v, $k) => $v->optStr($k, 255), false],
        'emergency_name' => [fn($v, $k) => $v->optStr($k, 100), false],
        'emergency_phone' => [fn($v, $k) => $v->optStr($k, 30), false],
        'department_id' => [fn($v, $k) => $v->optInt($k), false],
        'designation_id' => [fn($v, $k) => $v->optInt($k), false],
        'manager_id' => [fn($v, $k) => $v->optInt($k), false],
        'shift_id' => [fn($v, $k) => $v->optInt($k), false],
        'join_date' => [fn($v, $k) => $v->date($k), true],
        'employment_type' => [fn($v, $k) => $v->enum($k, ['full_time', 'part_time', 'contract', 'intern'], 'full_time'), false, 'full_time'],
        'work_location' => [fn($v, $k) => $v->optStr($k, 100), false],
        'status' => [fn($v, $k) => $v->enum($k, ['probation', 'active', 'notice', 'exited'], 'active'), false, 'active'],
        'probation_end' => [fn($v, $k) => $v->optDate($k), false],
        'exit_date' => [fn($v, $k) => $v->optDate($k), false],
        'bank_name' => [fn($v, $k) => $v->optStr($k, 100), false],
        'bank_account' => [fn($v, $k) => $v->optStr($k, 40), false],
        'ifsc' => [fn($v, $k) => $v->optStr($k, 20), false],
        'pan' => [fn($v, $k) => $v->optStr($k, 20), false],
        'aadhaar' => [fn($v, $k) => $v->optStr($k, 20), false],
        'uan' => [fn($v, $k) => $v->optStr($k, 20), false], // EPF Universal Account Number
        'esic_no' => [fn($v, $k) => $v->optStr($k, 20), false], // ESIC insurance number
    ];
    if ($create) {
        $spec['create_login'] = [fn($v, $k) => $v->bool($k), false];
        $spec['role_id'] = [fn($v, $k) => $v->optInt($k), false];
    }
    return $spec;
}

const EMP_SELECT = 'SELECT e.*, d.name AS department, g.title AS designation, m.first_name AS mgr_first, m.last_name AS mgr_last
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id
    LEFT JOIN employees m ON m.id = e.manager_id';

function emp_shape(array $row): array
{
    $mgrFirst = $row['mgr_first'];
    $mgrLast = $row['mgr_last'];
    unset($row['mgr_first'], $row['mgr_last']);
    $out = $row + ['name' => full_name($row)];
    $out['name'] = full_name($row);
    $canSee = has_perm('employee.view_sensitive') || (int) $row['id'] === user()['employeeId'];
    if (!$canSee) {
        foreach (SENSITIVE as $k) {
            unset($out[$k]);
        }
    }
    $out['manager_name'] = $mgrFirst ? trim($mgrFirst . ' ' . ($mgrLast ?? '')) : null;
    return $out;
}

function emp_next_code(): string
{
    return 'EMP' . str_pad((string) (((int) q_val('SELECT MAX(id) FROM employees')) + 1), 4, '0', STR_PAD_LEFT);
}

function assert_no_cycle(int $empId, int $managerId): void
{
    $cur = $managerId;
    $seen = [];
    while ($cur) {
        if ($cur === $empId) {
            throw new HttpError(400, 'A manager cannot report to their own subordinate');
        }
        if (isset($seen[$cur])) {
            break;
        }
        $seen[$cur] = true;
        $cur = (int) q_val('SELECT manager_id FROM employees WHERE id = ?', [$cur]);
    }
}

function emp_list(): void
{
    $ids = visible_ids('employee.view_all');
    $where = [];
    $p = [];
    if ($ids !== null) { $where[] = 'e.id IN (' . marks($ids) . ')'; $p = array_merge($p, $ids); }
    if (!empty($_GET['department_id'])) { $where[] = 'e.department_id = ?'; $p[] = (int) $_GET['department_id']; }
    if (!empty($_GET['status'])) { $where[] = 'e.status = ?'; $p[] = (string) $_GET['status']; }
    if (!empty($_GET['search'])) {
        $s = '%' . $_GET['search'] . '%';
        $where[] = '(e.first_name LIKE ? OR e.last_name LIKE ? OR e.emp_code LIKE ? OR e.email LIKE ?)';
        array_push($p, $s, $s, $s, $s);
    }
    $w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
    $realDoc = "SELECT 1 FROM employee_documents d WHERE d.employee_id = e.id AND d.type <> 'Profile Photo'";
    $docs = $_GET['docs'] ?? '';
    if ($docs === 'pending') { $where[] = "EXISTS ($realDoc AND d.verified_at IS NULL)"; }
    if ($docs === 'approved') { $where[] = "EXISTS ($realDoc AND d.verified_at IS NOT NULL) AND NOT EXISTS ($realDoc AND d.verified_at IS NULL)"; }
    $w = $where ? ' WHERE ' . implode(' AND ', $where) : '';
    $total = (int) q_val('SELECT COUNT(*) FROM employees e' . $w, $p);
    $take = min((int) ($_GET['limit'] ?? 20) ?: 20, 100);
    $page = max((int) ($_GET['page'] ?? 1), 1);
    $rows = q_all(EMP_SELECT . $w . ' ORDER BY e.id LIMIT ? OFFSET ?', array_merge($p, [$take, ($page - 1) * $take]));
    $counts = [];
    if ($rows) {
        $ids = array_map(fn($r) => (int) $r['id'], $rows);
        foreach (q_all("SELECT employee_id, COUNT(*) AS total, SUM(verified_at IS NOT NULL) AS approved FROM employee_documents WHERE type <> 'Profile Photo' AND employee_id IN (" . marks($ids) . ') GROUP BY employee_id', $ids) as $c) {
            $counts[(int) $c['employee_id']] = $c;
        }
    }
    $items = array_map(function ($r) use ($counts) {
        $c = $counts[(int) $r['id']] ?? null;
        $ok = (int) ($c['approved'] ?? 0);
        return emp_shape($r) + ['docs_approved' => $ok, 'docs_pending' => (int) ($c['total'] ?? 0) - $ok];
    }, $rows);
    respond(['total' => $total, 'page' => $page, 'limit' => $take, 'items' => $items]);
}

function emp_get(array $p): void
{
    assert_access((int) $p['id'], 'employee.view_all');
    $row = q_one(EMP_SELECT . ' WHERE e.id = ?', [(int) $p['id']]);
    if (!$row) {
        throw new HttpError(404, 'Employee not found');
    }
    respond(emp_shape($row));
}

function emp_mine(): void
{
    if (!user()['employeeId']) {
        throw new HttpError(404, 'No employee record linked to your account');
    }
    emp_get(['id' => user()['employeeId']]);
}

function emp_tree(): void
{
    $rows = q_all(EMP_SELECT . " WHERE e.status != 'exited'");
    respond(array_map(fn($r) => [
        'id' => $r['id'], 'name' => full_name($r), 'emp_code' => $r['emp_code'], 'designation' => $r['designation'],
        'department' => $r['department'], 'manager_id' => $r['manager_id'],
    ], $rows));
}

function emp_create(): void
{
    $d = parse_spec(req_body(), emp_spec(true));
    if (company() && (int) company()['max_employees'] > 0) { // the plan this company bought
        if ((int) q_val("SELECT COUNT(*) FROM employees WHERE status != 'exited'") >= (int) company()['max_employees']) {
            throw new HttpError(403, 'Your plan allows ' . company()['max_employees'] . ' employees. Please contact support to add more.');
        }
    }
    $createLogin = !empty($d['create_login']);
    $roleId = $d['role_id'] ?? null;
    unset($d['create_login'], $d['role_id']);
    if (!empty($d['manager_id'])) {
        assert_no_cycle(0, (int) $d['manager_id']);
    }
    $temp = null;
    $code = emp_next_code();
    $id = in_transaction(function () use ($d, $code, $createLogin, $roleId, &$temp) {
        $id = q_insert('employees', $d + ['emp_code' => $code, 'created_at' => ts(), 'updated_at' => ts()]);
        $to = array_filter(['department_id' => $d['department_id'] ?? null, 'designation_id' => $d['designation_id'] ?? null], fn($x) => $x !== null);
        q_insert('employment_history', [
            'employee_id' => $id, 'event' => 'joining', 'to_value' => json_encode($to ?: new stdClass()), 'effective_date' => $d['join_date'],
            'approved_by' => user()['id'], 'created_at' => ts(),
        ]);
        if ($createLogin) {
            $role = $roleId ?: (int) q_val("SELECT id FROM roles WHERE name = 'Employee'");
            $temp = random_token(6);
            q_insert('users', ['employee_id' => $id, 'email' => $d['email'], 'password_hash' => password_make($temp), 'must_change_password' => 1, 'role_id' => $role, 'created_at' => ts(), 'updated_at' => ts()]);
        }
        return $id;
    });
    if ($temp) {
        mail_welcome((string) $d['email'], (string) ($d['first_name'] ?? ''), $temp); // queued only after the employee was really saved
    }
    $log = $d;
    unset($log['aadhaar'], $log['pan'], $log['bank_account']);
    audit('employee', $id, 'create', null, $log);
    respond(emp_shape(q_one(EMP_SELECT . ' WHERE e.id = ?', [$id])) + ['temp_password' => $temp], 201);
}

function emp_update(array $p, ?array $data = null): void
{
    $d = $data ?? parse_spec(req_body(), emp_spec(false), true);
    $before = q_one('SELECT * FROM employees WHERE id = ?', [(int) $p['id']]);
    if (!$before) {
        throw new HttpError(404, 'Employee not found');
    }
    if (!empty($d['manager_id'])) {
        assert_no_cycle((int) $before['id'], (int) $d['manager_id']);
    }
    q_update('employees', $d + ['updated_at' => ts()], 'id = ?', [$before['id']]);
    if (!empty($d['email']) && $d['email'] !== $before['email']) {
        q_update('users', ['email' => $d['email']], 'employee_id = ?', [$before['id']]);
    }
    $after = q_one('SELECT * FROM employees WHERE id = ?', [$before['id']]);
    $strip = fn($o) => array_diff_key($o, array_flip(SENSITIVE));
    $changed = array_values(array_filter(SENSITIVE, fn($k) => array_key_exists($k, $d) && $d[$k] !== $before[$k]));
    audit('employee', $before['id'], 'update', $strip($before), $strip($after) + ['changed_sensitive' => $changed]);
    respond(emp_shape(q_one(EMP_SELECT . ' WHERE e.id = ?', [$before['id']])));
}

// Self-service: employees may edit only their own personal and bank/identity details.
function emp_update_me(): void
{
    if (!user()['employeeId']) {
        throw new HttpError(404, 'No employee record linked to your account');
    }
    $allowed = ['phone', 'dob', 'gender', 'address', 'emergency_name', 'emergency_phone', 'bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar', 'uan', 'esic_no'];
    $spec = array_intersect_key(emp_spec(false), array_flip($allowed));
    emp_update(['id' => user()['employeeId']], parse_spec(req_body(), $spec, true));
}

// ---------- documents ----------
// One-file document types: a new upload replaces the old file, until HR has verified it.
const SINGLE_DOC_TYPES = ['PAN Card', 'Aadhar Card', 'Driving Licence', 'Passport', 'Signature'];
const DOC_LOCKED_MSG = 'This document has been verified by HR and can no longer be changed. Ask HR if it needs correcting.';

function doc_access(int $employeeId): void
{
    if (has_perm('employee.manage') || $employeeId === user()['employeeId']) {
        return;
    }
    throw new HttpError(403, 'Not permitted');
}

function docs_list(array $p): void
{
    doc_access((int) $p['id']);
    $rows = q_all('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY id DESC', [(int) $p['id']]);
    respond(array_map(function ($r) { unset($r['file_path']); return $r; }, $rows));
}

function upload_error_check(string $field, int $maxBytes, string $tooBig): array
{
    if (empty($_FILES[$field]) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && empty($_POST)) {
        throw new HttpError(400, $tooBig); // the whole request was larger than the server allows
    }
    $f = $_FILES[$field] ?? null;
    if (!$f || $f['error'] === UPLOAD_ERR_NO_FILE) {
        throw new HttpError(400, 'File is required');
    }
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || $f['size'] > $maxBytes) {
        throw new HttpError(400, $tooBig);
    }
    if ($f['error'] !== UPLOAD_ERR_OK) {
        throw new HttpError(400, 'Upload failed. Please try again.');
    }
    return $f;
}

function detect_mime(string $path, string $fallback): string
{
    if (function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        $m = $fi ? finfo_file($fi, $path) : false;
        if ($m) {
            return $m;
        }
    }
    return $fallback;
}

// $ext is chosen by upload_inspect() from the file's real content, never taken from the name the user gave.
function save_upload(array $f, string $subdir, string $ext): array
{
    $dir = uploads_root() . '/' . $subdir;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
        throw new HttpError(500, 'Could not create the upload folder. Check that app/storage is writable.');
    }
    $name = uuid4() . '.' . $ext;
    $full = $dir . '/' . $name;
    if (!move_uploaded_file($f['tmp_name'], $full) && !@rename($f['tmp_name'], $full)) {
        throw new HttpError(500, 'Could not save the uploaded file.');
    }
    return ['full' => $full, 'rel' => $subdir . '/' . $name];
}

function send_stored_file(string $rel, string $filename, string $mime, bool $inline): void
{
    $root = uploads_root();
    $full = realpath($root . '/' . $rel);
    // The type comes from the extension WE chose when saving, never from the upload or the original name.
    $stored = strtolower(pathinfo((string) $rel, PATHINFO_EXTENSION));
    $mime = isset(UPLOAD_MIME[$stored]) ? UPLOAD_MIME[$stored] : 'application/octet-stream';
    $inline = $inline && in_array($stored, UPLOAD_IMAGE_EXT, true);
    if (!$full || strpos(str_replace('\\', '/', $full), $root . '/') !== 0 || !is_file($full)) {
        throw new HttpError(404, 'File missing');
    }
    http_response_code(200);
    header('Content-Type: ' . ($mime ?: 'application/octet-stream'));
    header('Content-Length: ' . filesize($full));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; sandbox");
    header('Cache-Control: private, no-store');
    $safe = rawurlencode($filename);
    header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename=\"" . preg_replace('/[^\x20-\x7e]/', '_', str_replace('"', '', $filename)) . "\"; filename*=UTF-8''" . $safe);
    readfile($full);
    exit;
}

function docs_add(array $p): void
{
    $eid = (int) $p['id'];
    doc_access($eid);
    $f = upload_error_check('file', 5 * 1024 * 1024, 'File is larger than 5 MB');
    // Only PDF, JPG and PNG, and only if the file really is one (see lib/security.php).
    $insp = upload_inspect($f['tmp_name'], (string) $f['name'], ['pdf', 'jpg', 'png']);
    $mime = $insp['mime'];
    $v = new V(req_body());
    $type = $v->str('type', 1, 50);
    $expires = $v->optDate('expires_on');
    $v->done();
    $isPhoto = $type === 'Profile Photo';
    if ($isPhoto && !in_array($mime, ['image/jpeg', 'image/png'], true)) {
        throw new HttpError(400, 'Profile photo must be a JPG or PNG image');
    }
    if ($isPhoto) { // a profile photo replaces the previous one
        foreach (q_all('SELECT * FROM employee_documents WHERE employee_id = ? AND type = ?', [$eid, 'Profile Photo']) as $old) {
            @unlink(uploads_root() . '/' . $old['file_path']);
            q_exec('DELETE FROM employee_documents WHERE id = ?', [$old['id']]);
        }
    }
    if (in_array($type, SINGLE_DOC_TYPES, true)) {
        $existing = q_all('SELECT * FROM employee_documents WHERE employee_id = ? AND type = ?', [$eid, $type]);
        foreach ($existing as $o) {
            if ($o['verified_at'] && !has_perm('employee.manage')) {
                throw new HttpError(403, DOC_LOCKED_MSG);
            }
        }
        foreach ($existing as $o) { // the new file replaces any file HR has not verified yet
            if (!$o['verified_at']) {
                @unlink(uploads_root() . '/' . $o['file_path']);
                q_exec('DELETE FROM employee_documents WHERE id = ?', [$o['id']]);
            }
        }
    }
    $saved = save_upload($f, 'employees/' . $eid, $insp['ext']);
    $id = q_insert('employee_documents', [
        'employee_id' => $eid, 'type' => $type, 'expires_on' => $expires, 'original_name' => mb_substr($f['name'], 0, 250), 'file_path' => $saved['rel'],
        'mime' => $mime, 'size' => (int) $f['size'], 'uploaded_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('employee_document', $id, 'upload', null, ['employee_id' => $eid, 'type' => $type]);
    respond(['id' => $id], 201);
}

function docs_download(array $p): void
{
    $doc = q_one('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?', [(int) $p['docId'], (int) $p['id']]);
    if (!$doc) {
        throw new HttpError(404, 'Document not found');
    }
    doc_access((int) $doc['employee_id']);
    audit('employee_document', $doc['id'], 'download');
    send_stored_file($doc['file_path'], $doc['original_name'], (string) $doc['mime'], false);
}

function docs_verify(array $p): void
{
    $doc = q_one('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?', [(int) $p['docId'], (int) $p['id']]);
    if (!$doc) {
        throw new HttpError(404, 'Document not found');
    }
    q_update('employee_documents', ['verified_by' => user()['id'], 'verified_at' => ts()], 'id = ?', [$doc['id']]);
    audit('employee_document', $doc['id'], 'verify');
    no_content();
}

function docs_delete(array $p): void
{
    $doc = q_one('SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?', [(int) $p['docId'], (int) $p['id']]);
    if (!$doc) {
        throw new HttpError(404, 'Document not found');
    }
    // HR can remove any document. An employee can remove their own until HR has verified it.
    $own = (int) $doc['employee_id'] === user()['employeeId'];
    if (!has_perm('employee.manage') && !($own && !$doc['verified_at'])) {
        throw new HttpError(403, $own ? DOC_LOCKED_MSG : 'Not permitted');
    }
    q_exec('DELETE FROM employee_documents WHERE id = ?', [$doc['id']]);
    @unlink(uploads_root() . '/' . $doc['file_path']);
    audit('employee_document', $doc['id'], 'delete', ['type' => $doc['type'], 'name' => $doc['original_name']]);
    no_content();
}

// ---------- employment history ----------
function json_or_null($v)
{
    if (is_string($v)) {
        $d = json_decode($v, true);
        return $d === null ? null : $d;
    }
    return $v;
}

function emp_history(array $p): void
{
    assert_access((int) $p['id'], 'employee.view_all');
    $rows = q_all('SELECT * FROM employment_history WHERE employee_id = ? ORDER BY effective_date DESC, id DESC', [(int) $p['id']]);
    respond(array_map(function ($r) {
        $r['from_value'] = json_or_null($r['from_value']);
        $r['to_value'] = json_or_null($r['to_value']);
        return $r;
    }, $rows));
}

function emp_add_event(array $p): void
{
    $v = new V(req_body());
    $event = $v->enum('event', ['confirmation', 'promotion', 'transfer', 'exit']);
    $eff = $v->has('effective_date') && req_body()['effective_date'] !== '' ? $v->date('effective_date') : today();
    $dept = $v->optInt('department_id');
    $desig = $v->optInt('designation_id');
    $mgr = $v->optInt('manager_id');
    $note = $v->optStr('note', 255);
    $v->done();
    $emp = q_one('SELECT * FROM employees WHERE id = ?', [(int) $p['id']]);
    if (!$emp) {
        throw new HttpError(404, 'Employee not found');
    }
    $changes = [];
    if ($event === 'confirmation') { $changes['status'] = 'active'; }
    if ($event === 'exit') { $changes['status'] = 'exited'; $changes['exit_date'] = $eff; }
    if ($event === 'promotion' && $desig) { $changes['designation_id'] = $desig; }
    if ($event === 'transfer') {
        if ($dept) { $changes['department_id'] = $dept; }
        if ($mgr) { assert_no_cycle((int) $emp['id'], $mgr); $changes['manager_id'] = $mgr; }
    }
    if (!$changes) {
        throw new HttpError(400, 'Nothing to change for this event');
    }
    $from = [];
    foreach (array_keys($changes) as $k) {
        $from[$k] = $emp[$k];
    }
    in_transaction(function () use ($emp, $changes, $event, $from, $eff, $note) {
        q_update('employees', $changes + ['updated_at' => ts()], 'id = ?', [$emp['id']]);
        q_insert('employment_history', [
            'employee_id' => $emp['id'], 'event' => $event, 'from_value' => json_encode($from), 'to_value' => json_encode($changes),
            'effective_date' => $eff, 'note' => $note, 'approved_by' => user()['id'], 'created_at' => ts(),
        ]);
        if ($event === 'exit') {
            q_update('users', ['is_active' => 0], 'employee_id = ?', [$emp['id']]);
        }
    });
    audit('employee', $emp['id'], $event, $from, $changes);
    notify_employee((int) $emp['id'], ['type' => 'employment', 'title' => "Your record was updated: $event", 'link' => '/profile']);
    respond(['ok' => true], 201);
}
