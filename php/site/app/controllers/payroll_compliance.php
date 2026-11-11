<?php
// Payroll compliance: second approver, professional tax slabs, one-off adjustments, calculators and statutory files.
// Mirrors server/src/controllers/payrollCompliance.js.

function pc_num($v): float { return (float) ($v ?? 0); }

// ============ settings (second approver) ============
function pc_settings_get(): void
{
    $s = q_one('SELECT dual_control FROM payroll_settings WHERE id = 1');
    respond(['dual_control' => (bool) ($s['dual_control'] ?? 0)]);
}

function pc_settings_update(): void
{
    require_admin();
    $v = new V(req_body());
    $on = (bool) $v->bool('dual_control');
    $v->done();
    q_update('payroll_settings', ['dual_control' => $on ? 1 : 0], 'id = ?', [1]);
    audit('payroll_settings', 1, 'update', null, ['dual_control' => $on]);
    respond(['dual_control' => $on]);
}

// ============ professional tax slabs ============
function pc_slab_shape(array $s): array
{
    return [
        'id' => (int) $s['id'], 'state_code' => $s['state_code'], 'state_name' => $s['state_name'], 'gender' => $s['gender'], 'from_amount' => (int) $s['from_amount'],
        'to_amount' => $s['to_amount'] === null ? null : (int) $s['to_amount'], 'monthly_amount' => (int) $s['monthly_amount'],
        'feb_amount' => $s['feb_amount'] === null ? null : (int) $s['feb_amount'], 'effective_from' => substr((string) $s['effective_from'], 0, 10), 'active' => (bool) $s['active'],
    ];
}

function pc_slabs(): void
{
    respond(array_map('pc_slab_shape', q_all('SELECT * FROM pt_slabs ORDER BY state_code, gender, from_amount')));
}

function pc_states(): void
{
    $rows = q_all('SELECT DISTINCT state_code, state_name FROM pt_slabs WHERE active = 1 ORDER BY state_name');
    $rows[] = ['state_code' => 'NONE', 'state_name' => 'No professional tax'];
    respond($rows);
}

function pc_slab_input(): array
{
    $b = req_body();
    $code = strtoupper(trim((string) ($b['state_code'] ?? '')));
    if (!preg_match('/^[A-Z]{2,10}$/', $code)) {
        throw new HttpError(400, 'Use the short state code, for example KA');
    }
    $name = hd_text($b['state_name'] ?? '', 2, 60, 'Enter the state name');
    $gender = hd_enum($b['gender'] ?? 'any', ['any', 'male', 'female'], 'Unknown gender');
    $from = (int) ($b['from_amount'] ?? -1);
    $to = isset($b['to_amount']) && $b['to_amount'] !== '' && $b['to_amount'] !== null ? (int) $b['to_amount'] : null;
    $amt = (int) ($b['monthly_amount'] ?? -1);
    $feb = isset($b['feb_amount']) && $b['feb_amount'] !== '' && $b['feb_amount'] !== null ? (int) $b['feb_amount'] : null;
    if ($from < 0 || $amt < 0 || $amt > 5000 || ($feb !== null && ($feb < 0 || $feb > 5000))) {
        throw new HttpError(400, 'Check the amounts');
    }
    if ($to !== null && $to < $from) {
        throw new HttpError(400, 'The upper limit must not be below the lower limit');
    }
    $eff = (string) ($b['effective_from'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $eff)) {
        throw new HttpError(400, 'Use YYYY-MM-DD');
    }
    return ['state_code' => $code, 'state_name' => $name, 'gender' => $gender, 'from_amount' => $from, 'to_amount' => $to, 'monthly_amount' => $amt, 'feb_amount' => $feb, 'effective_from' => $eff, 'active' => hd_bool($b['active'] ?? null, true) ? 1 : 0];
}

function pc_slab_add(): void
{
    require_admin();
    $d = pc_slab_input();
    $id = q_insert('pt_slabs', $d);
    audit('pt_slab', $id, 'create', null, $d);
    respond(['id' => $id], 201);
}

function pc_slab_update(array $p): void
{
    require_admin();
    $s = q_one('SELECT * FROM pt_slabs WHERE id = ?', [(int) $p['id']]);
    if (!$s) {
        throw new HttpError(404, 'Slab not found');
    }
    $d = pc_slab_input();
    q_update('pt_slabs', $d, 'id = ?', [$s['id']]);
    audit('pt_slab', $s['id'], 'update', $s, $d);
    respond(['ok' => true]);
}

function pc_slab_delete(array $p): void
{
    require_admin();
    $s = q_one('SELECT * FROM pt_slabs WHERE id = ?', [(int) $p['id']]);
    if (!$s) {
        throw new HttpError(404, 'Slab not found');
    }
    q_run('DELETE FROM pt_slabs WHERE id = ?', [$s['id']]);
    audit('pt_slab', $s['id'], 'delete', $s);
    no_content();
}

// ============ one-off adjustments ============
function pc_month_closed(string $month): bool
{
    return (bool) q_one("SELECT id FROM payroll_runs WHERE month = ? AND status != 'draft'", [$month]);
}

function pc_adjustments(): void
{
    $where = '';
    $p = [];
    if (!empty($_GET['month'])) { $where = ' WHERE a.month = ?'; $p[] = (string) $_GET['month']; }
    $rows = q_all('SELECT a.*, e.first_name, e.last_name, e.emp_code FROM payroll_adjustments a JOIN employees e ON e.id = a.employee_id' . $where . ' ORDER BY a.id DESC LIMIT 500', $p);
    $closed = [];
    $out = [];
    foreach ($rows as $r) {
        $closed[$r['month']] = $closed[$r['month']] ?? pc_month_closed($r['month']);
        $out[] = array_merge($r, ['id' => (int) $r['id'], 'employee_id' => (int) $r['employee_id'], 'amount' => (float) $r['amount'], 'name' => full_name($r), 'locked' => $closed[$r['month']]]);
    }
    respond($out);
}

function pc_adjustment_add(): void
{
    $b = req_body();
    $empId = (int) ($b['employee_id'] ?? 0);
    $month = (string) ($b['month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
        throw new HttpError(400, 'Use YYYY-MM');
    }
    $kind = hd_enum($b['kind'] ?? null, ['earning', 'deduction'], 'Choose earning or deduction');
    $label = hd_text($b['label'] ?? '', 2, 80, 'Enter a label (2 to 80 characters)');
    if (!is_numeric($b['amount'] ?? null) || (float) $b['amount'] <= 0 || (float) $b['amount'] > 100000000) {
        throw new HttpError(400, 'Enter an amount above zero');
    }
    $source = hd_enum($b['source'] ?? 'manual', ['manual', 'arrears', 'bonus', 'gratuity', 'leave_encashment', 'loan', 'other'], 'Unknown source');
    if (!q_one('SELECT id FROM employees WHERE id = ?', [$empId])) {
        throw new HttpError(404, 'Employee not found');
    }
    if (pc_month_closed($month)) {
        throw new HttpError(400, 'Payroll for that month is already approved, so nothing can be added. Use the next month.');
    }
    $id = q_insert('payroll_adjustments', ['employee_id' => $empId, 'month' => $month, 'kind' => $kind, 'label' => $label, 'amount' => (float) $b['amount'], 'source' => $source, 'note' => isset($b['note']) && $b['note'] !== '' ? mb_substr((string) $b['note'], 0, 255) : null, 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts()]);
    audit('payroll_adjustment', $id, 'create', null, compact('empId', 'month', 'kind', 'label'));
    respond(['id' => $id], 201);
}

function pc_adjustment_delete(array $p): void
{
    $a = q_one('SELECT * FROM payroll_adjustments WHERE id = ?', [(int) $p['id']]);
    if (!$a) {
        throw new HttpError(404, 'Adjustment not found');
    }
    if (pc_month_closed($a['month'])) {
        throw new HttpError(400, 'Payroll for that month is already approved, so this can no longer be removed.');
    }
    q_run('DELETE FROM payroll_adjustments WHERE id = ?', [$a['id']]);
    audit('payroll_adjustment', $a['id'], 'delete', $a);
    no_content();
}

// ============ calculators ============
function pc_basic_da(int $employeeId): ?float
{
    $s = current_structure($employeeId, '9999-12-31');
    if (!$s) {
        return null;
    }
    $off = q_col('SELECT code FROM salary_components WHERE is_standard = 1 AND active = 0');
    return (in_array('basic', $off, true) ? 0.0 : pc_num($s['basic'])) + (in_array('da', $off, true) ? 0.0 : pc_num($s['da']));
}

function pc_employee(int $id): array
{
    $e = q_one('SELECT * FROM employees WHERE id = ?', [$id]);
    if (!$e) {
        throw new HttpError(404, 'Employee not found');
    }
    return $e;
}

function pc_calc_gratuity(): void
{
    $b = req_body();
    $e = pc_employee((int) ($b['employee_id'] ?? 0));
    $end = !empty($b['last_working_day']) ? (string) $b['last_working_day'] : ($e['exit_date'] ? substr((string) $e['exit_date'], 0, 10) : null);
    if (!$end) {
        throw new HttpError(400, 'Enter the last working day');
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
        throw new HttpError(400, 'Use YYYY-MM-DD');
    }
    $reason = hd_enum($b['early_exit_reason'] ?? 'none', ['none', 'death', 'disability'], 'Unknown reason');
    $start = substr((string) $e['join_date'], 0, 10);
    if ($end < $start) {
        throw new HttpError(400, 'The last working day is before the joining date');
    }
    $wage = pc_basic_da((int) $e['id']);
    if ($wage === null) {
        throw new HttpError(400, 'This employee has no salary structure');
    }
    $rule = rules_on($end);
    $a = new DateTimeImmutable($start . ' UTC');
    $z = new DateTimeImmutable($end . ' UTC');
    $months = ((int) $z->format('Y') - (int) $a->format('Y')) * 12 + ((int) $z->format('n') - (int) $a->format('n'));
    $anchor = $a->modify("+$months months");
    if ($anchor > $z) {
        $months--;
    }
    $years = intdiv($months, 12);
    $extraMonths = $months - $years * 12;
    $anchor = $a->modify("+$months months");
    $extraDays = (int) round(($z->getTimestamp() - $anchor->getTimestamp()) / 86400);
    $counted = $years + ($extraMonths > 6 || ($extraMonths === 6 && $extraDays > 0) ? 1 : 0);
    $eligible = $years >= 5 || $reason !== 'none';
    $raw = ($wage * ($rule['gratuity_days'] ?? 15) / ($rule['gratuity_divisor'] ?? 26)) * $counted;
    $cap = 2000000;
    respond([
        'employee' => ['id' => (int) $e['id'], 'name' => full_name($e), 'emp_code' => $e['emp_code']], 'joined' => $start, 'last_working_day' => $end,
        'service' => ['years' => $years, 'months' => $extraMonths, 'counted_years' => $counted], 'last_drawn_basic_da' => r2($wage), 'eligible' => $eligible, 'cap' => $cap,
        'amount' => $eligible ? r2(min($raw, $cap)) : 0, 'uncapped' => r2($raw),
        'note' => $eligible ? ($raw > $cap ? 'Capped at Rs 20,00,000.' : 'Gratuity is tax-free up to the limit for most employees; confirm with your accountant.') : 'Not payable: less than 5 years of service (unless the exit is due to death or disability).',
    ]);
}

function pc_calc_leave(): void
{
    $b = req_body();
    $e = pc_employee((int) ($b['employee_id'] ?? 0));
    if (!is_numeric($b['days'] ?? null) || (float) $b['days'] <= 0 || (float) $b['days'] > 365) {
        throw new HttpError(400, 'Enter the number of days');
    }
    $wage = pc_basic_da((int) $e['id']);
    if ($wage === null) {
        throw new HttpError(400, 'This employee has no salary structure');
    }
    $perDay = $wage / 30;
    respond(['employee' => ['id' => (int) $e['id'], 'name' => full_name($e), 'emp_code' => $e['emp_code']], 'last_drawn_basic_da' => r2($wage), 'per_day' => r2($perDay), 'days' => (float) $b['days'], 'amount' => r2($perDay * (float) $b['days'])]);
}

function pc_calc_bonus(): void
{
    $b = req_body();
    $fy = (int) ($b['fy_start_year'] ?? 0);
    $pct = isset($b['percent']) ? (float) $b['percent'] : 8.33;
    $ceil = isset($b['wage_ceiling']) ? (float) $b['wage_ceiling'] : 7000.0;
    $limit = isset($b['eligibility_limit']) ? (float) $b['eligibility_limit'] : 21000.0;
    if ($fy < 2000 || $fy > 2100 || $pct < 8.33 || $pct > 20 || $ceil < 1000 || $limit < 1000) {
        throw new HttpError(400, 'Check the year, the percentage (8.33 to 20) and the limits');
    }
    $from = "$fy-04-01";
    $to = ($fy + 1) . '-03-31';
    $rows = [];
    foreach (q_all('SELECT * FROM employees WHERE join_date <= ? AND (exit_date IS NULL OR exit_date >= ?) ORDER BY first_name', [$to, $from]) as $e) {
        $wage = pc_basic_da((int) $e['id']);
        if ($wage === null) {
            continue;
        }
        $jd = substr((string) $e['join_date'], 0, 10);
        $start = $jd > $from ? $jd : $from;
        $ex = $e['exit_date'] ? substr((string) $e['exit_date'], 0, 10) : null;
        $end = $ex && $ex < $to ? $ex : $to;
        $sd = new DateTimeImmutable($start . ' UTC');
        $ed = new DateTimeImmutable($end . ' UTC');
        $months = min(12, max(0, ((int) $ed->format('Y') - (int) $sd->format('Y')) * 12 + ((int) $ed->format('n') - (int) $sd->format('n')) + 1));
        $eligible = $wage <= $limit && $months >= 1;
        $base = min($wage, $ceil);
        $rows[] = ['employee_id' => (int) $e['id'], 'name' => full_name($e), 'emp_code' => $e['emp_code'], 'basic_da' => r2($wage), 'calculation_wage' => r2($base), 'months' => $months, 'eligible' => $eligible, 'amount' => $eligible ? r2(($base * $pct / 100) * $months) : 0];
    }
    respond(['financial_year' => "$fy-" . substr((string) ($fy + 1), 2), 'percent' => $pct, 'rows' => $rows, 'total' => r2(array_sum(array_column($rows, 'amount')))]);
}

// ============ statutory files and bank file ============
function pc_clean($s): string { return trim(str_replace(['#', '~', "\r", "\n"], ' ', (string) $s)); }
function pc_ascii($s): string
{
    $t = function_exists('iconv') ? @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', pc_clean($s)) : pc_clean($s);
    return strtoupper(preg_replace('/[^\x20-\x7e]/', '', (string) $t));
}
function pc_csv(array $rows, array $columns): string
{
    $esc = fn($v) => preg_match('/[",\r\n]/', (string) $v) ? '"' . str_replace('"', '""', (string) $v) . '"' : (string) $v;
    $lines = [implode(',', array_map(fn($c) => $esc($c[1]), $columns))];
    foreach ($rows as $r) {
        $lines[] = implode(',', array_map(fn($c) => $esc($r[$c[0]] ?? ''), $columns));
    }
    return implode("\r\n", $lines) . "\r\n";
}

function pc_export(array $p): void
{
    $run = q_one('SELECT * FROM payroll_runs WHERE id = ?', [(int) $p['id']]);
    if (!$run) {
        throw new HttpError(404, 'Run not found');
    }
    if ($run['status'] === 'draft') {
        throw new HttpError(400, 'Approve the payroll run first. These files are made from approved figures.');
    }
    $kind = (string) $p['kind'];
    if (!in_array($kind, ['ecr', 'esic', 'pt', 'bank'], true)) {
        throw new HttpError(404, 'Unknown file');
    }
    $to = month_range($run['month'])['to'];
    $rule = rules_on($to);
    $rows = q_all('SELECT p.*, e.first_name, e.last_name, e.emp_code, e.uan, e.esic_no, e.bank_name, e.bank_account, e.ifsc FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.first_name', [$run['id']]);
    $warnings = [];
    $lines = [];
    $type = 'text/csv; charset=utf-8';
    if ($kind === 'ecr') {
        $ceil = $rule['pf_wage_ceiling'] ?? 15000;
        foreach ($rows as $r) {
            if (!(pc_num($r['pf_employee']) > 0 || pc_num($r['pf_wages']) > 0)) { continue; }
            if (!$r['uan']) { $warnings[] = full_name($r) . " ({$r['emp_code']}) has no UAN"; }
            $epf = (int) round(pc_num($r['pf_wages']));
            $eps = (int) min($epf, $ceil);
            $lines[] = implode('#~#', [pc_clean($r['uan']), pc_ascii(full_name($r)), (int) round(pc_num($r['gross'])), $epf, $eps, $eps, (int) round(pc_num($r['pf_employee'])), (int) round(pc_num($r['employer_eps'])), (int) round(pc_num($r['employer_pf'])) - (int) round(pc_num($r['employer_eps'])), (int) round(pc_num($r['lop_days'])), 0]);
        }
        $name = 'ECR-' . $run['month'] . '.txt';
        $type = 'text/plain; charset=utf-8';
        $body = implode("\r\n", $lines) . "\r\n";
        $count = count($lines);
    } elseif ($kind === 'esic') {
        $out = [];
        foreach ($rows as $r) {
            if (!(pc_num($r['esic_employee']) > 0 || pc_num($r['employer_esic']) > 0)) { continue; }
            if (!$r['esic_no']) { $warnings[] = full_name($r) . " ({$r['emp_code']}) has no ESIC IP number"; }
            $out[] = ['a' => $r['esic_no'] ?: '', 'b' => full_name($r), 'c' => (int) round(pc_num($r['paid_days'])), 'd' => (int) round(pc_num($r['statutory_wages']) ?: pc_num($r['gross'])), 'e' => 0, 'f' => ''];
        }
        $name = 'ESIC-' . $run['month'] . '.csv';
        $body = "\xEF\xBB\xBF" . pc_csv($out, [['a', 'IP Number'], ['b', 'IP Name'], ['c', 'No of days for which wages paid/payable during the month'], ['d', 'Total monthly wages'], ['e', 'Reason code for zero working days (numeric only; provide 0 for none)'], ['f', 'Last working day']]);
        $count = count($out);
    } elseif ($kind === 'pt') {
        $states = [];
        foreach (q_all('SELECT DISTINCT state_code, state_name FROM pt_slabs') as $s) { $states[$s['state_code']] = $s['state_name']; }
        $out = [];
        $total = 0.0;
        foreach ($rows as $r) {
            if (!(pc_num($r['professional_tax']) > 0)) { continue; }
            $s = current_structure((int) $r['employee_id'], $to);
            $code = $s['pt_state'] ?? '';
            $out[] = ['state' => $states[$code] ?? $code, 'code' => $r['emp_code'], 'name' => full_name($r), 'gross' => pc_num($r['gross']), 'pt' => pc_num($r['professional_tax'])];
            $total += pc_num($r['professional_tax']);
        }
        usort($out, fn($a, $b) => strcmp($a['state'], $b['state']));
        $out[] = ['state' => 'TOTAL', 'code' => '', 'name' => '', 'gross' => '', 'pt' => r2($total)];
        $name = 'Professional-tax-' . $run['month'] . '.csv';
        $body = "\xEF\xBB\xBF" . pc_csv($out, [['state', 'State'], ['code', 'Employee code'], ['name', 'Employee'], ['gross', 'Gross salary'], ['pt', 'Professional tax']]);
        $count = count($out) - 1;
    } else {
        $out = [];
        foreach ($rows as $r) {
            if (!(pc_num($r['net']) > 0)) { continue; }
            if (!$r['bank_account'] || !$r['ifsc']) { $warnings[] = full_name($r) . " ({$r['emp_code']}) has no bank account or IFSC"; continue; }
            $out[] = ['name' => full_name($r), 'acc' => $r['bank_account'], 'ifsc' => strtoupper((string) $r['ifsc']), 'amount' => r2(pc_num($r['net'])), 'narr' => 'Salary ' . $run['month'], 'code' => $r['emp_code'], 'bank' => $r['bank_name'] ?: ''];
        }
        $name = 'Bank-transfer-' . $run['month'] . '.csv';
        $body = "\xEF\xBB\xBF" . pc_csv($out, [['name', 'Beneficiary name'], ['acc', 'Account number'], ['ifsc', 'IFSC'], ['amount', 'Amount'], ['narr', 'Narration'], ['code', 'Employee code'], ['bank', 'Bank']]);
        $count = count($out);
    }
    if (($_GET['check'] ?? '') === '1') {
        respond(['kind' => $kind, 'file' => $name, 'rows' => $count, 'warnings' => $warnings]);
    }
    audit('payroll_run', $run['id'], 'export_' . $kind);
    http_response_code(200);
    header('Content-Type: ' . $type);
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo $body;
    exit;
}
