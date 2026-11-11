<?php
// HR desk: help desk, policies with acknowledgement, and asset tracking. Mirrors server/src/controllers/hrDesk.js.

function hd_is_hr(): bool { return has_perm('employee.manage'); }
function hd_hr_user_ids(): array
{
    return array_map('intval', q_col('SELECT u.id FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.`key` = ? AND u.is_active = 1', ['employee.manage']));
}
function hd_enum($v, array $allowed, string $msg): string
{
    if (!is_string($v) || !in_array($v, $allowed, true)) {
        throw new HttpError(400, $msg);
    }
    return $v;
}
function hd_text($v, int $min, int $max, string $msg): string
{
    $s = trim((string) $v);
    if (mb_strlen($s) < $min || mb_strlen($s) > $max) {
        throw new HttpError(400, $msg);
    }
    return $s;
}
function hd_bool($v, bool $default): bool
{
    return $v === null ? $default : in_array($v, [true, 1, '1', 'true'], true);
}

// ====================== Help desk ======================
const HD_CATEGORIES = ['hr', 'payroll', 'it', 'admin', 'grievance', 'other'];
const HD_TICKET_SQL = 'SELECT t.*, e.first_name, e.last_name, e.emp_code, u.email AS assigned_email FROM helpdesk_tickets t JOIN employees e ON e.id = t.employee_id LEFT JOIN users u ON u.id = t.assigned_to';
function hd_ticket(array $t): array { return $t + ['name' => full_name($t)]; }

function hd_tickets(): void
{
    $where = [];
    $p = [];
    if (($_GET['scope'] ?? '') === 'all') {
        if (!hd_is_hr()) {
            throw new HttpError(403, 'Not permitted');
        }
    } else {
        $where[] = 't.employee_id = ?';
        $p[] = require_employee();
    }
    if (!empty($_GET['status'])) { $where[] = 't.status = ?'; $p[] = (string) $_GET['status']; }
    $rows = q_all(HD_TICKET_SQL . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY t.updated_at DESC LIMIT 300', $p);
    respond(array_map('hd_ticket', $rows));
}

function hd_ticket_create(): void
{
    $b = req_body();
    $category = hd_enum($b['category'] ?? null, HD_CATEGORIES, 'Choose a category');
    $subject = hd_text($b['subject'] ?? '', 3, 150, 'Write a short subject (3 to 150 characters)');
    $desc = hd_text($b['description'] ?? '', 5, 5000, 'Describe the problem (5 to 5000 characters)');
    $priority = hd_enum($b['priority'] ?? 'normal', ['low', 'normal', 'high'], 'Invalid priority');
    $emp = get_employee(require_employee());
    $id = q_insert('helpdesk_tickets', ['employee_id' => $emp['id'], 'category' => $category, 'subject' => $subject, 'description' => $desc, 'priority' => $priority, 'status' => 'open', 'created_at' => ts(), 'updated_at' => ts()]);
    audit('helpdesk_ticket', $id, 'create', null, ['category' => $category]);
    notify_users(array_values(array_diff(hd_hr_user_ids(), [user()['id']])), [
        'type' => 'helpdesk', 'title' => ($category === 'grievance' ? 'Grievance' : 'New ticket') . ' from ' . full_name($emp) . ': ' . $subject, 'body' => mb_substr($desc, 0, 200), 'link' => '/helpdesk',
    ]);
    respond(['id' => $id], 201);
}

function hd_load(int $id): array
{
    $t = q_one(HD_TICKET_SQL . ' WHERE t.id = ?', [$id]);
    if (!$t || (!hd_is_hr() && (int) $t['employee_id'] !== user()['employeeId'])) {
        throw new HttpError(404, 'Ticket not found'); // never reveal that it exists
    }
    return $t;
}

function hd_ticket_get(array $p): void
{
    $t = hd_load((int) $p['id']);
    $rows = q_all('SELECT c.*, u.email, e.first_name, e.last_name FROM helpdesk_comments c JOIN users u ON u.id = c.user_id LEFT JOIN employees e ON e.id = u.employee_id WHERE c.ticket_id = ?' . (hd_is_hr() ? '' : ' AND c.is_internal = 0') . ' ORDER BY c.id', [$t['id']]);
    respond(hd_ticket($t) + ['comments' => array_map(fn($x) => $x + ['is_internal' => (bool) $x['is_internal'], 'name' => $x['first_name'] ? full_name($x) : $x['email']], $rows)]);
}

function hd_comment_add(array $p): void
{
    $t = hd_load((int) $p['id']);
    $b = req_body();
    $body = hd_text($b['body'] ?? '', 1, 5000, 'Write a message');
    $internal = !empty($b['internal']);
    if ($internal && !hd_is_hr()) {
        throw new HttpError(403, 'Only HR can add internal notes');
    }
    if ($t['status'] === 'closed') {
        throw new HttpError(400, 'This ticket is closed. Open it again to reply.');
    }
    $id = q_insert('helpdesk_comments', ['ticket_id' => $t['id'], 'user_id' => user()['id'], 'body' => $body, 'is_internal' => $internal ? 1 : 0, 'created_at' => ts()]);
    $set = ['updated_at' => ts()];
    if ($t['status'] === 'resolved' && !hd_is_hr()) {
        $set += ['status' => 'open', 'resolved_at' => null];
    }
    q_update('helpdesk_tickets', $set, 'id = ?', [$t['id']]);
    if (!$internal) {
        if (hd_is_hr() && (int) $t['employee_id'] !== user()['employeeId']) {
            notify_employee((int) $t['employee_id'], ['type' => 'helpdesk', 'title' => 'Reply on your ticket: ' . $t['subject'], 'body' => mb_substr($body, 0, 200), 'link' => '/helpdesk']);
        } elseif (!hd_is_hr()) {
            notify_users(array_values(array_diff(hd_hr_user_ids(), [user()['id']])), ['type' => 'helpdesk', 'title' => full_name($t) . ' replied on: ' . $t['subject'], 'body' => mb_substr($body, 0, 200), 'link' => '/helpdesk']);
        }
    }
    respond(['id' => $id], 201);
}

function hd_ticket_update(array $p): void
{
    $t = hd_load((int) $p['id']);
    $b = req_body();
    $d = [];
    if (array_key_exists('status', $b)) { $d['status'] = hd_enum($b['status'], ['open', 'in_progress', 'resolved', 'closed'], 'Unknown status'); }
    if (array_key_exists('priority', $b)) { $d['priority'] = hd_enum($b['priority'], ['low', 'normal', 'high'], 'Invalid priority'); }
    if (array_key_exists('assigned_to', $b)) { $d['assigned_to'] = $b['assigned_to'] === null ? null : (int) $b['assigned_to']; }
    if (!hd_is_hr()) {
        if (isset($d['priority']) || array_key_exists('assigned_to', $d)) {
            throw new HttpError(403, 'Not permitted');
        }
        if (isset($d['status']) && !in_array($d['status'], ['closed', 'open'], true)) {
            throw new HttpError(403, 'You can close your ticket or open it again');
        }
    }
    if (!empty($d['assigned_to']) && !in_array($d['assigned_to'], hd_hr_user_ids(), true)) {
        throw new HttpError(400, 'Choose someone from the HR team');
    }
    if (isset($d['status'])) {
        $d['resolved_at'] = in_array($d['status'], ['resolved', 'closed'], true) ? ts() : null;
    }
    if ($d) {
        q_update('helpdesk_tickets', $d + ['updated_at' => ts()], 'id = ?', [$t['id']]);
    }
    audit('helpdesk_ticket', $t['id'], 'update', ['status' => $t['status'], 'priority' => $t['priority']], $d);
    if (hd_is_hr() && isset($d['status']) && $d['status'] !== $t['status'] && (int) $t['employee_id'] !== user()['employeeId']) {
        notify_employee((int) $t['employee_id'], ['type' => 'helpdesk', 'title' => 'Your ticket "' . $t['subject'] . '" is now ' . str_replace('_', ' ', $d['status']), 'link' => '/helpdesk']);
    }
    respond(['ok' => true]);
}

// ====================== Policies ======================
function hd_policies(): void
{
    $empId = user()['employeeId'];
    $acks = $empId ? q_all('SELECT * FROM policy_acks WHERE employee_id = ?', [$empId]) : [];
    $out = [];
    foreach (q_all('SELECT * FROM policies ORDER BY title') as $p) {
        if (!hd_is_hr() && !$p['active']) {
            continue;
        }
        unset($p['file_path']);
        $ack = null;
        foreach ($acks as $a) { if ((int) $a['policy_id'] === (int) $p['id']) { $ack = $a; } }
        $done = $ack && (int) $ack['version'] === (int) $p['version'];
        $out[] = array_merge($p, [
            'id' => (int) $p['id'], 'version' => (int) $p['version'], 'size' => (int) $p['size'], 'requires_ack' => (bool) $p['requires_ack'], 'active' => (bool) $p['active'],
            'acknowledged' => (bool) $done, 'acknowledged_at' => $done ? $ack['acknowledged_at'] : null, 'pending' => (bool) $p['active'] && (bool) $p['requires_ack'] && !$done,
        ]);
    }
    respond($out);
}

function hd_policy_file(): array
{
    $f = upload_error_check('file', 10 * 1024 * 1024, 'File is larger than 10 MB');
    $insp = upload_inspect($f['tmp_name'], (string) $f['name'], ['pdf', 'docx']);
    $saved = save_upload($f, 'policies', $insp['ext']);
    return ['rel' => $saved['rel'], 'name' => mb_substr((string) $f['name'], 0, 250), 'mime' => $insp['mime'], 'size' => (int) $f['size']];
}

function hd_policy_create(): void
{
    $b = req_body();
    $title = hd_text($b['title'] ?? '', 3, 150, 'Write a title (3 to 150 characters)');
    $desc = isset($b['description']) && $b['description'] !== '' ? mb_substr((string) $b['description'], 0, 1000) : null;
    if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
        throw new HttpError(400, 'Choose the policy file (PDF or Word)');
    }
    $f = hd_policy_file();
    $id = q_insert('policies', [
        'title' => $title, 'description' => $desc, 'file_path' => $f['rel'], 'original_name' => $f['name'], 'mime' => $f['mime'], 'size' => $f['size'], 'version' => 1,
        'requires_ack' => hd_bool($b['requires_ack'] ?? null, true) ? 1 : 0, 'active' => 1, 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('policy', $id, 'create', null, ['title' => $title]);
    $ids = array_map('intval', q_col('SELECT id FROM users WHERE is_active = 1 AND employee_id IS NOT NULL'));
    notify_users(array_values(array_diff($ids, [user()['id']])), ['type' => 'policy', 'title' => 'New policy: ' . $title, 'body' => 'Please read it and acknowledge.', 'link' => '/policies']);
    respond(['id' => $id], 201);
}

// Edit the details, or send a new file (which raises the version so people acknowledge again). Uses POST so a file can be sent.
function hd_policy_update(array $p): void
{
    $pol = q_one('SELECT * FROM policies WHERE id = ?', [(int) $p['id']]);
    if (!$pol) {
        throw new HttpError(404, 'Policy not found');
    }
    $b = req_body();
    $set = [];
    if (isset($b['title'])) { $set['title'] = hd_text($b['title'], 3, 150, 'Write a title (3 to 150 characters)'); }
    if (array_key_exists('description', $b)) { $set['description'] = $b['description'] === null || $b['description'] === '' ? null : mb_substr((string) $b['description'], 0, 1000); }
    if (array_key_exists('requires_ack', $b)) { $set['requires_ack'] = hd_bool($b['requires_ack'], true) ? 1 : 0; }
    if (array_key_exists('active', $b)) { $set['active'] = hd_bool($b['active'], true) ? 1 : 0; }
    $newFile = !empty($_FILES['file']) && $_FILES['file']['error'] !== UPLOAD_ERR_NO_FILE;
    if ($newFile) {
        $f = hd_policy_file();
        $set += ['file_path' => $f['rel'], 'original_name' => $f['name'], 'mime' => $f['mime'], 'size' => $f['size'], 'version' => (int) $pol['version'] + 1];
        @unlink(uploads_root() . '/' . $pol['file_path']);
    }
    if ($set) {
        q_update('policies', $set + ['updated_at' => ts()], 'id = ?', [$pol['id']]);
    }
    audit('policy', $pol['id'], $newFile ? 'new_version' : 'update', null, ['version' => $set['version'] ?? (int) $pol['version']]);
    if ($newFile) {
        $ids = array_map('intval', q_col('SELECT id FROM users WHERE is_active = 1 AND employee_id IS NOT NULL'));
        notify_users(array_values(array_diff($ids, [user()['id']])), ['type' => 'policy', 'title' => 'Policy updated: ' . ($set['title'] ?? $pol['title']), 'body' => 'A new version needs your acknowledgement.', 'link' => '/policies']);
    }
    respond(['ok' => true, 'version' => $set['version'] ?? (int) $pol['version']]);
}

function hd_policy_delete(array $p): void
{
    $pol = q_one('SELECT * FROM policies WHERE id = ?', [(int) $p['id']]);
    if (!$pol) {
        throw new HttpError(404, 'Policy not found');
    }
    q_run('DELETE FROM policies WHERE id = ?', [$pol['id']]);
    @unlink(uploads_root() . '/' . $pol['file_path']);
    audit('policy', $pol['id'], 'delete', ['title' => $pol['title']]);
    no_content();
}

function hd_policy_download(array $p): void
{
    $pol = q_one('SELECT * FROM policies WHERE id = ?', [(int) $p['id']]);
    if (!$pol || (!$pol['active'] && !hd_is_hr())) {
        throw new HttpError(404, 'Policy not found');
    }
    send_stored_file($pol['file_path'], $pol['original_name'], '', false);
}

function hd_policy_ack(array $p): void
{
    $emp = require_employee();
    $pol = q_one('SELECT * FROM policies WHERE id = ? AND active = 1', [(int) $p['id']]);
    if (!$pol) {
        throw new HttpError(404, 'Policy not found');
    }
    if (q_one('SELECT policy_id FROM policy_acks WHERE policy_id = ? AND employee_id = ?', [$pol['id'], $emp])) {
        q_update('policy_acks', ['version' => $pol['version'], 'acknowledged_at' => ts(), 'ip' => client_ip()], 'policy_id = ? AND employee_id = ?', [$pol['id'], $emp]);
    } else {
        q_insert('policy_acks', ['policy_id' => $pol['id'], 'employee_id' => $emp, 'version' => $pol['version'], 'acknowledged_at' => ts(), 'ip' => client_ip()]);
    }
    audit('policy', $pol['id'], 'acknowledge', null, ['version' => (int) $pol['version']]);
    respond(['ok' => true]);
}

function hd_policy_acks(array $p): void
{
    $pol = q_one('SELECT * FROM policies WHERE id = ?', [(int) $p['id']]);
    if (!$pol) {
        throw new HttpError(404, 'Policy not found');
    }
    $acks = [];
    foreach (q_all('SELECT * FROM policy_acks WHERE policy_id = ?', [$pol['id']]) as $a) {
        $acks[(int) $a['employee_id']] = $a;
    }
    $rows = [];
    foreach (q_all("SELECT id, first_name, last_name, emp_code FROM employees WHERE status != 'exited' ORDER BY first_name") as $e) {
        $a = $acks[(int) $e['id']] ?? null;
        $done = $a && (int) $a['version'] === (int) $pol['version'];
        $rows[] = ['id' => (int) $e['id'], 'name' => full_name($e), 'emp_code' => $e['emp_code'], 'acknowledged' => (bool) $done, 'acknowledged_at' => $done ? $a['acknowledged_at'] : null];
    }
    respond(['policy' => ['id' => (int) $pol['id'], 'title' => $pol['title'], 'version' => (int) $pol['version']], 'done' => count(array_filter($rows, fn($r) => $r['acknowledged'])), 'total' => count($rows), 'rows' => $rows]);
}

// ====================== Assets ======================
const HD_ASSET_CATEGORIES = ['laptop', 'phone', 'id_card', 'access_card', 'accessory', 'other'];

function hd_asset_input(bool $partial): array
{
    $b = req_body();
    $d = [];
    if (!$partial || isset($b['tag'])) { $d['tag'] = hd_text($b['tag'] ?? '', 2, 40, 'Enter the asset tag (2 to 40 characters)'); }
    if (!$partial || isset($b['name'])) { $d['name'] = hd_text($b['name'] ?? '', 2, 120, 'Enter the asset name'); }
    if (!$partial || isset($b['category'])) { $d['category'] = hd_enum($b['category'] ?? null, HD_ASSET_CATEGORIES, 'Choose a category'); }
    foreach (['serial_no' => 80, 'notes' => 1000] as $k => $max) {
        if (array_key_exists($k, $b)) { $d[$k] = $b[$k] === null || $b[$k] === '' ? null : mb_substr((string) $b[$k], 0, $max); }
    }
    if (array_key_exists('purchase_date', $b)) {
        if ($b['purchase_date'] !== null && $b['purchase_date'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $b['purchase_date'])) { throw new HttpError(400, 'Use YYYY-MM-DD'); }
        $d['purchase_date'] = $b['purchase_date'] ?: null;
    }
    if (array_key_exists('value', $b)) {
        if ($b['value'] !== null && $b['value'] !== '' && (!is_numeric($b['value']) || (float) $b['value'] < 0)) { throw new HttpError(400, 'Value must be zero or more'); }
        $d['value'] = $b['value'] === null || $b['value'] === '' ? null : (float) $b['value'];
    }
    if (isset($b['status'])) { $d['status'] = hd_enum($b['status'], ['available', 'repair', 'retired'], 'Unknown status'); }
    return $d;
}

function hd_assets(): void
{
    $where = [];
    $p = [];
    foreach (['status', 'category'] as $k) {
        if (!empty($_GET[$k])) { $where[] = "a.$k = ?"; $p[] = (string) $_GET[$k]; }
    }
    if (!empty($_GET['q'])) {
        $where[] = '(a.tag LIKE ? OR a.name LIKE ? OR a.serial_no LIKE ?)';
        $like = '%' . $_GET['q'] . '%';
        array_push($p, $like, $like, $like);
    }
    $rows = q_all(
        'SELECT a.*, s.employee_id AS holder_id, s.issued_on, e.first_name, e.last_name, e.emp_code FROM assets a LEFT JOIN asset_assignments s ON s.asset_id = a.id AND s.returned_on IS NULL LEFT JOIN employees e ON e.id = s.employee_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY a.tag LIMIT 500',
        $p
    );
    respond(array_map(fn($a) => $a + ['holder' => $a['holder_id'] ? full_name($a) : null], $rows));
}

function hd_asset_create(): void
{
    $d = hd_asset_input(false);
    if (q_one('SELECT id FROM assets WHERE tag = ?', [$d['tag']])) {
        throw new HttpError(409, 'An asset with this tag already exists');
    }
    $id = q_insert('assets', $d + ['status' => $d['status'] ?? 'available', 'created_at' => ts(), 'updated_at' => ts()]);
    audit('asset', $id, 'create', null, $d);
    respond(['id' => $id], 201);
}

function hd_asset_get(int $id): array
{
    $a = q_one('SELECT * FROM assets WHERE id = ?', [$id]);
    if (!$a) {
        throw new HttpError(404, 'Asset not found');
    }
    return $a;
}

function hd_asset_update(array $p): void
{
    $a = hd_asset_get((int) $p['id']);
    $d = hd_asset_input(true);
    if (isset($d['tag']) && $d['tag'] !== $a['tag'] && q_one('SELECT id FROM assets WHERE tag = ?', [$d['tag']])) {
        throw new HttpError(409, 'An asset with this tag already exists');
    }
    if (isset($d['status']) && $a['status'] === 'assigned') {
        throw new HttpError(400, 'Take the asset back from the employee before changing its status');
    }
    if ($d) {
        q_update('assets', $d + ['updated_at' => ts()], 'id = ?', [$a['id']]);
    }
    audit('asset', $a['id'], 'update', $a, $d);
    respond(['ok' => true]);
}

function hd_asset_delete(array $p): void
{
    $a = hd_asset_get((int) $p['id']);
    if (q_one('SELECT id FROM asset_assignments WHERE asset_id = ? LIMIT 1', [$a['id']])) {
        throw new HttpError(409, 'This asset has been issued before, so its history is kept. Mark it as retired instead.');
    }
    q_run('DELETE FROM assets WHERE id = ?', [$a['id']]);
    audit('asset', $a['id'], 'delete', $a);
    no_content();
}

function hd_asset_history(array $p): void
{
    $a = hd_asset_get((int) $p['id']);
    $rows = q_all('SELECT s.*, e.first_name, e.last_name, e.emp_code FROM asset_assignments s JOIN employees e ON e.id = s.employee_id WHERE s.asset_id = ? ORDER BY s.id DESC', [$a['id']]);
    respond(['asset' => $a, 'history' => array_map(fn($r) => $r + ['name' => full_name($r)], $rows)]);
}

function hd_asset_assign(array $p): void
{
    $a = hd_asset_get((int) $p['id']);
    $b = req_body();
    $empId = (int) ($b['employee_id'] ?? 0);
    $issued = !empty($b['issued_on']) ? (string) $b['issued_on'] : today();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $issued)) {
        throw new HttpError(400, 'Use YYYY-MM-DD');
    }
    if ($a['status'] !== 'available') {
        throw new HttpError(409, $a['status'] === 'assigned' ? 'This asset is already issued. Take it back first.' : "This asset is {$a['status']} and cannot be issued");
    }
    $emp = q_one('SELECT * FROM employees WHERE id = ?', [$empId]);
    if (!$emp || $emp['status'] === 'exited') {
        throw new HttpError(400, 'Choose a current employee');
    }
    in_transaction(function () use ($a, $emp, $issued, $b) {
        q_insert('asset_assignments', ['asset_id' => $a['id'], 'employee_id' => $emp['id'], 'issued_on' => $issued, 'condition_out' => isset($b['condition']) ? mb_substr((string) $b['condition'], 0, 120) : null, 'issued_by' => user()['id'], 'notes' => isset($b['notes']) ? mb_substr((string) $b['notes'], 0, 255) : null, 'created_at' => ts(), 'updated_at' => ts()]);
        q_update('assets', ['status' => 'assigned', 'updated_at' => ts()], 'id = ?', [$a['id']]);
    });
    audit('asset', $a['id'], 'assign', null, ['employee_id' => (int) $emp['id']]);
    notify_employee((int) $emp['id'], ['type' => 'employment', 'title' => "{$a['name']} ({$a['tag']}) was issued to you", 'link' => '/profile?tab=assets']);
    respond(['ok' => true], 201);
}

function hd_asset_return(array $p): void
{
    $a = hd_asset_get((int) $p['id']);
    $b = req_body();
    $returned = !empty($b['returned_on']) ? (string) $b['returned_on'] : today();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $returned)) {
        throw new HttpError(400, 'Use YYYY-MM-DD');
    }
    $status = hd_enum($b['status'] ?? 'available', ['available', 'repair', 'retired'], 'Unknown status');
    $open = q_one('SELECT * FROM asset_assignments WHERE asset_id = ? AND returned_on IS NULL', [$a['id']]);
    if (!$open) {
        throw new HttpError(400, 'This asset is not issued to anyone');
    }
    in_transaction(function () use ($a, $open, $returned, $b, $status) {
        q_update('asset_assignments', ['returned_on' => $returned, 'condition_in' => isset($b['condition']) ? mb_substr((string) $b['condition'], 0, 120) : null, 'returned_by' => user()['id'], 'notes' => isset($b['notes']) ? mb_substr((string) $b['notes'], 0, 255) : $open['notes'], 'updated_at' => ts()], 'id = ?', [$open['id']]);
        q_update('assets', ['status' => $status, 'updated_at' => ts()], 'id = ?', [$a['id']]);
    });
    audit('asset', $a['id'], 'return', null, ['employee_id' => (int) $open['employee_id']]);
    respond(['ok' => true]);
}

function hd_employee_assets(array $p): void
{
    $empId = (int) $p['id'];
    if (!hd_is_hr() && $empId !== user()['employeeId']) {
        throw new HttpError(403, 'Not permitted');
    }
    $rows = q_all('SELECT s.*, a.tag, a.name, a.category, a.serial_no FROM asset_assignments s JOIN assets a ON a.id = s.asset_id WHERE s.employee_id = ? ORDER BY s.id DESC', [$empId]);
    respond(['holding' => array_values(array_filter($rows, fn($r) => !$r['returned_on'])), 'history' => array_values(array_filter($rows, fn($r) => (bool) $r['returned_on']))]);
}
