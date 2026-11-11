<?php
// Letters: templates and the letters issued to employees. Mirrors server/src/controllers/letters.js.

const LTR_TYPES = ['offer', 'appointment', 'experience', 'relieving', 'custom'];
const LTR_PREFIX = ['offer' => 'OFR', 'appointment' => 'APT', 'experience' => 'EXP', 'relieving' => 'REL', 'custom' => 'LTR'];
const LTR_PLACEHOLDERS = [
    ['employee_name', 'Full name'], ['first_name', 'First name'], ['employee_code', 'Employee code'], ['designation', 'Designation'], ['department', 'Department'],
    ['joining_date', 'Date of joining'], ['last_working_day', 'Last working day'], ['resignation_date', 'Resignation date'], ['work_location', 'Work location'],
    ['manager_name', 'Reporting manager'], ['employment_type', 'Employment type'], ['salary_monthly', 'Monthly gross salary'], ['salary_annual', 'Annual gross salary'],
    ['probation_months', 'Probation (months)'], ['notice_period', 'Notice period'], ['company_name', 'Company name'], ['company_address', 'Company address'], ['today', "Today's date"],
    ['signatory_name', 'Signatory name'], ['signatory_title', 'Signatory title'],
];

function ltr_is_hr(): bool { return has_perm('employee.manage'); }
function ltr_long_date(?string $d): ?string { return $d ? gmdate('j F Y', strtotime(substr($d, 0, 10) . ' UTC')) : null; }
// Indian digit grouping: 1,23,456
function ltr_rupees(float $n): string
{
    $s = (string) (int) round($n);
    $last = substr($s, -3);
    $rest = substr($s, 0, -3);
    if ($rest !== '' && $rest !== false) {
        $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);
        return 'Rs. ' . $rest . ',' . $last;
    }
    return 'Rs. ' . $s;
}

// Everything a letter can mention, taken from the employee, their current salary and the company profile.
function ltr_variables(int $employeeId, array $extra): array
{
    $e = q_one(
        'SELECT e.*, d.name AS department, g.title AS designation, m.first_name AS m_first, m.last_name AS m_last FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id LEFT JOIN employees m ON m.id = e.manager_id WHERE e.id = ?',
        [$employeeId]
    );
    if (!$e) {
        throw new HttpError(404, 'Employee not found');
    }
    $co = q_one('SELECT * FROM company_profile WHERE id = 1') ?: [];
    $monthly = null;
    $s = current_structure($employeeId, '9999-12-31');
    if ($s) {
        $comps = q_all('SELECT * FROM salary_components');
        $off = [];
        $live = [];
        foreach ($comps as $c) {
            if ($c['is_standard'] && !$c['active']) { $off[] = $c['code']; }
            if (!$c['is_standard'] && $c['active'] && $c['kind'] === 'earning') { $live[(int) $c['id']] = true; }
        }
        $monthly = 0.0;
        foreach (['basic', 'da', 'hra', 'allowances', 'conveyance', 'travelling_allowance', 'medical', 'other_allowance'] as $k) {
            if (!in_array($k, $off, true)) { $monthly += (float) ($s[$k] ?? 0); }
        }
        foreach (q_all('SELECT component_id, amount FROM salary_structure_items WHERE structure_id = ?', [$s['id']]) as $i) {
            if (isset($live[(int) $i['component_id']])) { $monthly += (float) $i['amount']; }
        }
    }
    return [
        'employee_name' => full_name($e), 'first_name' => $e['first_name'], 'employee_code' => $e['emp_code'], 'designation' => $e['designation'], 'department' => $e['department'],
        'joining_date' => ltr_long_date($e['join_date']), 'last_working_day' => ltr_long_date($extra['last_working_day'] ?? $e['exit_date']), 'resignation_date' => ltr_long_date($extra['resignation_date'] ?? null),
        'work_location' => $e['work_location'], 'manager_name' => $e['m_first'] ? trim($e['m_first'] . ' ' . ($e['m_last'] ?? '')) : null,
        'employment_type' => str_replace('_', ' ', (string) $e['employment_type']),
        'salary_monthly' => $monthly ? ltr_rupees($monthly) : null, 'salary_annual' => $monthly ? ltr_rupees($monthly * 12) : null,
        'probation_months' => !empty($extra['probation_months']) ? (string) $extra['probation_months'] : '6', 'notice_period' => !empty($extra['notice_period']) ? (string) $extra['notice_period'] : '30 days',
        'company_name' => $co['name'] ?? null, 'company_address' => $co['address'] ?? null, 'today' => ltr_long_date(today()),
        'signatory_name' => !empty($extra['signatory_name']) ? $extra['signatory_name'] : ($co['signatory_name'] ?? null), 'signatory_title' => !empty($extra['signatory_title']) ? $extra['signatory_title'] : ($co['signatory_title'] ?? null),
    ];
}

function ltr_render(string $text, array $v): string
{
    return preg_replace_callback('/\{\{\s*(\w+)\s*\}\}/', fn($m) => array_key_exists($m[1], $v) ? ($v[$m[1]] ? (string) $v[$m[1]] : '[not set]') : $m[0], $text);
}

function ltr_template_input(bool $partial): array
{
    $b = req_body();
    $d = [];
    if (!$partial || isset($b['type'])) { $d['type'] = hd_enum($b['type'] ?? null, LTR_TYPES, 'Choose a type'); }
    if (!$partial || isset($b['name'])) { $d['name'] = hd_text($b['name'] ?? '', 2, 100, 'Enter a name'); }
    if (!$partial || isset($b['title'])) { $d['title'] = hd_text($b['title'] ?? '', 2, 150, 'Enter the heading of the letter'); }
    if (!$partial || isset($b['body'])) { $d['body'] = hd_text($b['body'] ?? '', 10, 10000, 'The letter text must be 10 to 10000 characters'); }
    if (isset($b['active'])) { $d['active'] = hd_bool($b['active'], true) ? 1 : 0; }
    return $d;
}

function ltr_templates(): void
{
    $rows = array_map(fn($t) => array_merge($t, ['id' => (int) $t['id'], 'is_default' => (bool) $t['is_default'], 'active' => (bool) $t['active']]), q_all('SELECT * FROM letter_templates ORDER BY id'));
    respond(['templates' => $rows, 'placeholders' => LTR_PLACEHOLDERS]);
}

function ltr_template_create(): void
{
    $d = ltr_template_input(false);
    $id = q_insert('letter_templates', $d + ['active' => $d['active'] ?? 1, 'is_default' => 0, 'created_at' => ts(), 'updated_at' => ts()]);
    audit('letter_template', $id, 'create', null, ['name' => $d['name']]);
    respond(['id' => $id], 201);
}

function ltr_template_update(array $p): void
{
    $t = q_one('SELECT * FROM letter_templates WHERE id = ?', [(int) $p['id']]);
    if (!$t) {
        throw new HttpError(404, 'Template not found');
    }
    $d = ltr_template_input(true);
    if ($t['is_default'] && isset($d['type']) && $d['type'] !== $t['type']) {
        throw new HttpError(400, 'The type of a built-in template cannot be changed');
    }
    if ($d) {
        q_update('letter_templates', $d + ['updated_at' => ts()], 'id = ?', [$t['id']]);
    }
    audit('letter_template', $t['id'], 'update', null, ['name' => $d['name'] ?? $t['name']]);
    respond(['ok' => true]);
}

function ltr_template_delete(array $p): void
{
    $t = q_one('SELECT * FROM letter_templates WHERE id = ?', [(int) $p['id']]);
    if (!$t) {
        throw new HttpError(404, 'Template not found');
    }
    if ($t['is_default']) {
        throw new HttpError(400, 'The built-in templates cannot be deleted. Switch it off instead.');
    }
    q_run('DELETE FROM letter_templates WHERE id = ?', [$t['id']]);
    audit('letter_template', $t['id'], 'delete', ['name' => $t['name']]);
    no_content();
}

function ltr_preview(): void
{
    $b = req_body();
    $t = q_one('SELECT * FROM letter_templates WHERE id = ?', [(int) ($b['template_id'] ?? 0)]);
    if (!$t) {
        throw new HttpError(404, 'Template not found');
    }
    $v = ltr_variables((int) ($b['employee_id'] ?? 0), is_array($b['extra'] ?? null) ? $b['extra'] : []);
    $body = ltr_render($t['body'], $v);
    respond(['title' => ltr_render($t['title'], $v), 'body' => $body, 'type' => $t['type'], 'signatory_name' => $v['signatory_name'], 'signatory_title' => $v['signatory_title'], 'missing' => strpos($body, '[not set]') !== false]);
}

function ltr_next_reference(string $type, string $year): string
{
    $prefix = (LTR_PREFIX[$type] ?? 'LTR') . "/$year/";
    $last = q_one('SELECT reference_no FROM letters WHERE reference_no LIKE ? ORDER BY id DESC LIMIT 1', [$prefix . '%']);
    $n = $last ? (int) substr(strrchr($last['reference_no'], '/'), 1) + 1 : 1;
    while (q_one('SELECT id FROM letters WHERE reference_no = ?', [$prefix . str_pad((string) $n, 4, '0', STR_PAD_LEFT)])) {
        $n++;
    }
    return $prefix . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
}

function ltr_create(): void
{
    $b = req_body();
    $emp = q_one('SELECT * FROM employees WHERE id = ?', [(int) ($b['employee_id'] ?? 0)]);
    if (!$emp) {
        throw new HttpError(404, 'Employee not found');
    }
    $type = hd_enum($b['type'] ?? 'custom', LTR_TYPES, 'Choose a type');
    $title = hd_text($b['title'] ?? '', 2, 150, 'Enter the heading of the letter');
    $body = hd_text($b['body'] ?? '', 10, 10000, 'The letter text must be 10 to 10000 characters');
    if (preg_match('/\{\{\s*\w+\s*\}\}/', $body)) {
        throw new HttpError(400, 'The letter still contains a {{placeholder}}. Remove or replace it before issuing.');
    }
    $issued = !empty($b['issued_on']) ? (string) $b['issued_on'] : today();
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $issued)) {
        throw new HttpError(400, 'Use YYYY-MM-DD');
    }
    $ref = ltr_next_reference($type, substr($issued, 0, 4));
    $id = q_insert('letters', [
        'employee_id' => $emp['id'], 'template_id' => !empty($b['template_id']) ? (int) $b['template_id'] : null, 'type' => $type, 'title' => $title, 'body' => $body, 'reference_no' => $ref,
        'issued_on' => $issued, 'signatory_name' => isset($b['signatory_name']) ? mb_substr((string) $b['signatory_name'], 0, 100) : null,
        'signatory_title' => isset($b['signatory_title']) ? mb_substr((string) $b['signatory_title'], 0, 100) : null, 'issued_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('letter', $id, 'issue', null, ['employee_id' => (int) $emp['id'], 'reference_no' => $ref, 'type' => $type]);
    notify_employee((int) $emp['id'], ['type' => 'employment', 'title' => "A letter was issued to you: $title", 'link' => "/letters/$id"]);
    respond(['id' => $id, 'reference_no' => $ref], 201);
}

function ltr_list(): void
{
    $where = [];
    $p = [];
    if (ltr_is_hr()) {
        if (!empty($_GET['employee_id'])) { $where[] = 'l.employee_id = ?'; $p[] = (int) $_GET['employee_id']; }
    } else {
        $where[] = 'l.employee_id = ?';
        $p[] = (int) (user()['employeeId'] ?: 0);
    }
    if (!empty($_GET['type'])) { $where[] = 'l.type = ?'; $p[] = (string) $_GET['type']; }
    $rows = q_all('SELECT l.id, l.type, l.title, l.reference_no, l.issued_on, l.employee_id, e.first_name, e.last_name, e.emp_code FROM letters l JOIN employees e ON e.id = l.employee_id' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY l.id DESC LIMIT 300', $p);
    respond(array_map(fn($l) => array_merge($l, ['id' => (int) $l['id'], 'employee_id' => (int) $l['employee_id'], 'name' => full_name($l)]), $rows));
}

function ltr_get(array $p): void
{
    $l = q_one('SELECT l.*, e.first_name, e.last_name, e.emp_code FROM letters l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', [(int) $p['id']]);
    if (!$l || (!ltr_is_hr() && (int) $l['employee_id'] !== user()['employeeId'])) {
        throw new HttpError(404, 'Letter not found');
    }
    respond(array_merge($l, ['id' => (int) $l['id'], 'employee_id' => (int) $l['employee_id'], 'name' => full_name($l)]));
}

function ltr_delete(array $p): void
{
    $l = q_one('SELECT * FROM letters WHERE id = ?', [(int) $p['id']]);
    if (!$l) {
        throw new HttpError(404, 'Letter not found');
    }
    q_run('DELETE FROM letters WHERE id = ?', [$l['id']]);
    audit('letter', $l['id'], 'delete', ['reference_no' => $l['reference_no'], 'employee_id' => (int) $l['employee_id']]);
    no_content();
}
