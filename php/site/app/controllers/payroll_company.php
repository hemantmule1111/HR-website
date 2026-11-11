<?php
// Payroll (salary structures, monthly runs, payslips) and the company profile used on payslips.

const PAYSLIP_NUM = ['total_days', 'paid_days', 'lop_days', 'basic', 'hra', 'allowances', 'gross', 'deductions', 'net', 'da', 'conveyance', 'travelling_allowance', 'medical', 'other_allowance', 'overtime_hours', 'overtime_pay', 'statutory_wages', 'pf_wages', 'pf_employee', 'esic_employee', 'professional_tax', 'tds', 'other_deductions', 'employer_pf', 'employer_eps', 'employer_edli', 'employer_admin', 'employer_esic', 'gratuity_provision', 'employer_cost'];
const STRUCT_NUM = ['basic', 'hra', 'allowances', 'deductions', 'da', 'conveyance', 'travelling_allowance', 'medical', 'other_allowance', 'tds', 'esic_applicable', 'overtime_eligible'];
function r2(float $n): float { return round($n * 100) / 100; }

function current_structure(int $employeeId, string $date): ?array
{
    return q_one('SELECT * FROM salary_structures WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', [$employeeId, $date]);
}

function struct_list(): void
{
    $empId = (int) ($_GET['employeeId'] ?? 0) ?: (int) user()['employeeId'];
    if (!has_perm('payroll.view_all') && $empId !== user()['employeeId']) {
        throw new HttpError(403, 'Not permitted');
    }
    $rows = cast_rows(q_all('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC', [$empId]), STRUCT_NUM);
    $items = $rows ? q_all('SELECT structure_id, component_id, amount FROM salary_structure_items WHERE structure_id IN (' . marks(array_column($rows, 'id')) . ')', array_column($rows, 'id')) : [];
    foreach ($rows as &$r) {
        $r['items'] = array_values(array_map(fn($i) => ['component_id' => (int) $i['component_id'], 'amount' => (float) $i['amount']], array_filter($items, fn($i) => (int) $i['structure_id'] === (int) $r['id'])));
    }
    unset($r);
    respond($rows);
}

function struct_add(): void
{
    $v = new V(req_body());
    $d = [
        'employee_id' => $v->int('employee_id'), 'basic' => $v->num('basic', 0),
        'effective_from' => $v->date('effective_from'),
    ];
    foreach (['hra', 'da', 'conveyance', 'travelling_allowance', 'medical', 'allowances', 'other_allowance', 'deductions', 'tds'] as $k) {
        $d[$k] = $v->has($k) && $v->in[$k] !== '' ? $v->num($k, 0) : 0;
    }
    $d['pf_mode'] = $v->enum('pf_mode', ['ceiling', 'actual', 'none'], 'ceiling');
    $d['pt_state'] = strtoupper(trim((string) ($v->in['pt_state'] ?? 'MH')));
    if (!preg_match('/^[A-Z]{2,10}$/', $d['pt_state'])) {
        throw new HttpError(400, 'Choose a professional tax state');
    }
    $d['esic_applicable'] = $v->bool('esic_applicable') ? 1 : 0;
    $d['overtime_eligible'] = $v->has('overtime_eligible') && $v->bool('overtime_eligible') === false ? 0 : 1;
    $note = $v->optStr('note', 255);
    $rawItems = is_array($v->in['items'] ?? null) ? $v->in['items'] : [];
    $v->done();
    $valid = array_map('intval', q_col('SELECT id FROM salary_components WHERE is_standard = 0'));
    $items = [];
    foreach ($rawItems as $it) {
        $cid = (int) ($it['component_id'] ?? 0);
        $amt = $it['amount'] ?? 0;
        if (!in_array($cid, $valid, true)) {
            throw new HttpError(400, 'Unknown salary category');
        }
        if (!is_numeric($amt) || (float) $amt < 0) {
            throw new HttpError(400, 'Amounts must be zero or more');
        }
        if ((float) $amt > 0) {
            $items[$cid] = (float) $amt;
        }
    }
    if ($d['pt_state'] !== 'NONE' && !q_one('SELECT id FROM pt_slabs WHERE state_code = ? AND active = 1', [$d['pt_state']])) {
        throw new HttpError(400, 'Unknown professional tax state. Add its slabs on the Master sheet first.');
    }
    if (!q_one('SELECT id FROM employees WHERE id = ?', [$d['employee_id']])) {
        throw new HttpError(404, 'Employee not found');
    }
    $id = q_insert('salary_structures', $d + ['note' => $note, 'created_by' => user()['id'], 'created_at' => ts()]);
    foreach ($items as $cid => $amt) {
        q_insert('salary_structure_items', ['structure_id' => $id, 'component_id' => $cid, 'amount' => $amt]);
    }
    audit('salary_structure', $id, 'create', null, $d + ['items' => $items]);
    respond(['id' => $id], 201);
}

// ---------- Indian payroll maths (mirrors server/src/services/payrollCalc.js) ----------
// Latest value of each statutory rule already in force on $date.
function rules_on(string $date): array
{
    $out = [];
    foreach (q_all('SELECT rule_key, value, effective_from FROM statutory_rules ORDER BY effective_from ASC, id ASC') as $r) {
        if (substr((string) $r['effective_from'], 0, 10) <= $date) {
            $out[$r['rule_key']] = (float) $r['value'];
        }
    }
    return $out;
}

// Maharashtra professional tax; February carries the extra rupees so the year totals Rs 2,500.
// Professional tax from the slabs a state publishes. Slabs are on monthly gross. Some states charge more in February.
function pt_from_slabs(string $state, ?string $gender, float $gross, int $monthNo, array $slabs): float
{
    if ($state === '' || $state === 'NONE') {
        return 0.0;
    }
    $mine = array_values(array_filter($slabs, fn($s) => $s['state_code'] === $state && !empty($s['active'])));
    if (!$mine) {
        return 0.0;
    }
    $latest = max(array_map(fn($s) => substr((string) $s['effective_from'], 0, 10), $mine));
    $current = array_values(array_filter($mine, fn($s) => substr((string) $s['effective_from'], 0, 10) === $latest));
    $byGender = array_values(array_filter($current, fn($s) => $s['gender'] === $gender));
    $use = $byGender ?: array_values(array_filter($current, fn($s) => in_array($s['gender'], ['any', 'male'], true)));
    foreach ($use as $s) {
        if ($gross >= (float) $s['from_amount'] && ($s['to_amount'] === null || $gross <= (float) $s['to_amount'])) {
            return $monthNo === 2 && $s['feb_amount'] !== null ? (float) $s['feb_amount'] : (float) $s['monthly_amount'];
        }
    }
    return 0.0;
}

function professional_tax(string $state, ?string $gender, float $gross, int $monthNo): float
{
    if ($state !== 'MH') {
        return 0.0;
    }
    if ($gender === 'female') {
        return $gross > 25000 ? ($monthNo === 2 ? 300.0 : 200.0) : 0.0;
    }
    if ($gross <= 7500) {
        return 0.0;
    }
    if ($gross <= 10000) {
        return 175.0;
    }
    return $monthNo === 2 ? 300.0 : 200.0;
}

// $extra = ['off' => standard earnings switched off, 'earn' => [[id, name, amount, in_wages]], 'ded' => [[id, name, amount]]]
function calc_pay(array $s, float $factor, array $rule, ?string $gender, int $monthNo, array $extra = []): array
{
    $off = $extra['off'] ?? [];
    $part = fn(string $k) => in_array($k, $off, true) ? 0.0 : r2((float) ($s[$k] ?? 0) * $factor);
    $basic = $part('basic'); $da = $part('da'); $hra = $part('hra'); $special = $part('allowances');
    $conv = $part('conveyance'); $travel = $part('travelling_allowance'); $med = $part('medical'); $other = $part('other_allowance');
    $earnItems = [];
    foreach ($extra['earn'] ?? [] as $c) {
        $amt = r2((float) $c['amount'] * $factor);
        if ($amt > 0) {
            $earnItems[] = ['component_id' => $c['id'], 'name' => $c['name'], 'kind' => 'earning', 'amount' => $amt, 'in_wages' => !empty($c['in_wages'])];
        }
    }
    $customEarn = array_sum(array_column($earnItems, 'amount'));
    $customWage = array_sum(array_column(array_filter($earnItems, fn($i) => $i['in_wages']), 'amount'));
    $fixedGross = r2($basic + $da + $hra + $special + $conv + $travel + $med + $other + $customEarn);
    // Overtime is paid on top of salary. It is not wages for PF / ESIC / gratuity and it is left out of the 50% rule.
    $otHours = r2((float) ($extra['ot']['hours'] ?? 0));
    $otPay = r2((float) ($extra['ot']['pay'] ?? 0));
    // One-off lines for this month (arrears, bonus, leave encashment ...). Paid in full, and not counted as wages for PF / ESIC.
    $adjEarn = [];
    $adjDed = [];
    foreach ($extra['adjust']['earn'] ?? [] as $a) {
        if ((float) $a['amount'] > 0) { $adjEarn[] = ['component_id' => null, 'name' => $a['label'], 'kind' => 'earning', 'amount' => r2((float) $a['amount'])]; }
    }
    foreach ($extra['adjust']['ded'] ?? [] as $a) {
        if ((float) $a['amount'] > 0) { $adjDed[] = ['component_id' => null, 'name' => $a['label'], 'kind' => 'deduction', 'amount' => r2((float) $a['amount'])]; }
    }
    $adjEarnTotal = array_sum(array_column($adjEarn, 'amount'));
    $adjDedTotal = array_sum(array_column($adjDed, 'amount'));
    $gross = r2($fixedGross + $otPay + $adjEarnTotal);

    // Allowances left out of "wages" may not exceed 50% of total remuneration (Labour Codes).
    $excluded = $hra + $conv + $travel + $med + $other + ($customEarn - $customWage);
    $addBack = max(0.0, $excluded - $fixedGross * (($rule['wage_exclusion_limit'] ?? 50) / 100));
    $wages = r2($basic + $da + $special + $customWage + $addBack);

    $ceil = $rule['pf_wage_ceiling'] ?? 0;
    $pfWages = $s['pf_mode'] === 'none' ? 0.0 : ($s['pf_mode'] === 'actual' ? $wages : min($wages, $ceil));
    $pfEmp = r2($pfWages * ($rule['pf_employee_rate'] ?? 0) / 100);
    $erPf = r2($pfWages * ($rule['pf_employer_rate'] ?? 0) / 100);
    $erEps = r2(min($pfWages, $ceil) * ($rule['eps_rate'] ?? 0) / 100);
    $edli = r2($pfWages * ($rule['edli_rate'] ?? 0) / 100);
    $admin = r2($pfWages * ($rule['epf_admin_rate'] ?? 0) / 100);

    $esicOn = !empty($s['esic_applicable']) && $wages > 0 && $wages <= ($rule['esic_wage_ceiling'] ?? 0);
    $esicEmp = $esicOn ? ceil($wages * ($rule['esic_employee_rate'] ?? 0) / 100) : 0.0;
    $erEsic = $esicOn ? ceil($wages * ($rule['esic_employer_rate'] ?? 0) / 100) : 0.0;

    $pt = isset($extra['ptSlabs']) ? pt_from_slabs((string) $s['pt_state'], $gender, $gross, $monthNo, $extra['ptSlabs']) : professional_tax((string) $s['pt_state'], $gender, $gross, $monthNo);
    $tds = r2((float) ($s['tds'] ?? 0));
    $otherDed = r2((float) ($s['deductions'] ?? 0));
    $dedItems = [];
    foreach ($extra['ded'] ?? [] as $c) {
        $amt = r2((float) $c['amount']);
        if ($amt > 0) {
            $dedItems[] = ['component_id' => $c['id'], 'name' => $c['name'], 'kind' => 'deduction', 'amount' => $amt];
        }
    }
    $ded = r2($pfEmp + $esicEmp + $pt + $tds + $otherDed + $adjDedTotal + array_sum(array_column($dedItems, 'amount')));
    $grat = r2($wages * ($rule['gratuity_days'] ?? 15) / ($rule['gratuity_divisor'] ?? 26) / 12);
    return [
        'basic' => $basic, 'da' => $da, 'hra' => $hra, 'allowances' => $special, 'conveyance' => $conv, 'travelling_allowance' => $travel, 'medical' => $med, 'other_allowance' => $other, 'overtime_hours' => $otHours, 'overtime_pay' => $otPay, 'gross' => $gross,
        'statutory_wages' => $wages, 'pf_wages' => r2($pfWages), 'pf_employee' => $pfEmp, 'esic_employee' => $esicEmp, 'professional_tax' => $pt, 'tds' => $tds,
        'other_deductions' => $otherDed, 'deductions' => $ded, 'net' => max(0, r2($gross - $ded)),
        'employer_pf' => $erPf, 'employer_eps' => $erEps, 'employer_edli' => $edli, 'employer_admin' => $admin, 'employer_esic' => $erEsic,
        'items' => array_map(fn($i) => array_diff_key($i, ['in_wages' => 1]), array_merge($earnItems, $dedItems, $adjEarn, $adjDed)),
        'gratuity_provision' => $grat, 'employer_cost' => r2($gross + $erPf + $edli + $admin + $erEsic + $grat),
    ];
}

// Statutory rates (dated; history kept so old payrolls stay reproducible)
function rules_list(): void
{
    respond(cast_rows(q_all('SELECT * FROM statutory_rules ORDER BY rule_key, effective_from DESC, id DESC'), ['value']));
}

function rules_add(): void
{
    $v = new V(req_body());
    $d = ['rule_key' => $v->str('rule_key', 1, 40), 'value' => $v->num('value', 0), 'effective_from' => $v->date('effective_from')];
    $note = $v->optStr('note', 255);
    $v->done();
    if (!q_one('SELECT id FROM statutory_rules WHERE rule_key = ?', [$d['rule_key']])) {
        throw new HttpError(400, 'Unknown rule');
    }
    $id = q_insert('statutory_rules', $d + ['note' => $note, 'created_by' => user()['id'], 'created_at' => ts()]);
    audit('statutory_rule', $id, 'create', null, $d);
    respond(['id' => $id], 201);
}

// One payslip per employee for the month, with pay pro-rated for unpaid days.
function payroll_compute(array $run): array
{
    $r = month_range($run['month']);
    $emps = q_all('SELECT * FROM employees WHERE join_date <= ? AND (exit_date IS NULL OR exit_date >= ?) ORDER BY id', [$r['to'], $r['from']]);
    $slips = [];
    $rule = rules_on($r['to']);
    $comps = q_all('SELECT * FROM salary_components');
    $off = array_values(array_map(fn($c) => $c['code'], array_filter($comps, fn($c) => $c['is_standard'] && !$c['active'])));
    $policy = ot_policy();
    $ptSlabs = q_all('SELECT * FROM pt_slabs WHERE active = 1 AND effective_from <= ?', [$r['to']]);
    $adjustments = q_all('SELECT * FROM payroll_adjustments WHERE month = ?', [$run['month']]);
    $custom = [];
    foreach ($comps as $c) {
        if (!$c['is_standard'] && $c['active']) {
            $custom[(int) $c['id']] = $c;
        }
    }
    foreach ($emps as $e) {
        $s = current_structure((int) $e['id'], $r['to']);
        if (!$s) {
            continue;
        }
        $paid = 0.0;
        foreach (day_statuses($e, $r['from'], $r['to']) as $d) {
            $paid += $d['paid'];
        }
        $factor = min(1, $paid / $r['days']);
        $earn = [];
        $dedc = [];
        foreach (q_all('SELECT component_id, amount FROM salary_structure_items WHERE structure_id = ?', [$s['id']]) as $i) {
            $c = $custom[(int) $i['component_id']] ?? null;
            if (!$c) {
                continue;
            }
            $row = ['id' => (int) $c['id'], 'name' => $c['name'], 'amount' => (float) $i['amount'], 'in_wages' => (bool) $c['in_wages']];
            if ($c['kind'] === 'deduction') { $dedc[] = $row; } else { $earn[] = $row; }
        }
        // Overtime: approved hours in this month, paid at the rate fixed when each request was approved.
        $ot = $policy['enabled'] && (int) ($s['overtime_eligible'] ?? 1) ? ot_approved_for((int) $e['id'], $r['from'], $r['to'], ot_hourly_rate($s, $policy, $off, $earn)) : ['hours' => 0, 'pay' => 0];
        $pay = calc_pay($s, $factor, $rule, $e['gender'] ?? null, (int) substr($run['month'], 5, 2), ['off' => $off, 'earn' => $earn, 'ded' => $dedc, 'ot' => $ot, 'ptSlabs' => $ptSlabs, 'adjust' => [
            'earn' => array_values(array_filter($adjustments, fn($a) => (int) $a['employee_id'] === (int) $e['id'] && $a['kind'] === 'earning')),
            'ded' => array_values(array_filter($adjustments, fn($a) => (int) $a['employee_id'] === (int) $e['id'] && $a['kind'] === 'deduction')),
        ]]);
        $slips[] = [
            'run_id' => (int) $run['id'], 'employee_id' => (int) $e['id'], 'total_days' => $r['days'], 'paid_days' => $paid, 'lop_days' => max(0, $r['days'] - $paid),
        ] + $pay + ['created_at' => ts()];
    }
    return $slips;
}

// A payslip row plus its lines for the categories the company added.
function save_slips(array $slips): void
{
    foreach ($slips as $slip) {
        $items = $slip['items'] ?? [];
        unset($slip['items']);
        $id = q_insert('payslips', $slip);
        foreach ($items as $i) {
            q_insert('payslip_items', ['payslip_id' => $id, 'component_id' => $i['component_id'], 'name' => $i['name'], 'kind' => $i['kind'], 'amount' => $i['amount']]);
        }
    }
}

function payroll_runs_list(): void
{
    $rows = q_all(
        'SELECT r.id, r.month, r.status, r.created_by, r.approved_by, r.created_at, r.updated_at, COUNT(p.id) AS employees, SUM(p.net) AS net_total
         FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id
         GROUP BY r.id, r.month, r.status, r.created_by, r.approved_by, r.created_at, r.updated_at ORDER BY r.month DESC'
    );
    respond(array_map(fn($r) => ['employees' => (int) $r['employees'], 'net_total' => (float) ($r['net_total'] ?? 0)] + $r, $rows));
}

function payroll_run_create(): void
{
    $v = new V(req_body());
    $month = $v->month('month');
    $v->done();
    if ($month > current_month()) {
        throw new HttpError(400, 'Cannot run payroll for a future month');
    }
    if (q_one('SELECT id FROM payroll_runs WHERE month = ?', [$month])) {
        throw new HttpError(409, 'Payroll for this month already exists');
    }
    $runId = q_insert('payroll_runs', ['month' => $month, 'created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts()]);
    try {
        $slips = payroll_compute(['id' => $runId, 'month' => $month]);
        if (!$slips) {
            throw new HttpError(400, 'No employees with a salary structure for this month');
        }
        save_slips($slips);
    } catch (Throwable $e) {
        q_exec('DELETE FROM payroll_runs WHERE id = ?', [$runId]);
        throw $e;
    }
    audit('payroll_run', $runId, 'create', null, ['month' => $month]);
    respond(['id' => $runId], 201);
}

function payroll_run_get(int $id): array
{
    $run = q_one('SELECT * FROM payroll_runs WHERE id = ?', [$id]);
    if (!$run) {
        throw new HttpError(404, 'Run not found');
    }
    return $run;
}

function payroll_recompute(array $p): void
{
    $run = payroll_run_get((int) $p['id']);
    if ($run['status'] !== 'draft') {
        throw new HttpError(400, 'Only draft runs can be recomputed');
    }
    $slips = payroll_compute($run);
    in_transaction(function () use ($run, $slips) {
        q_exec('DELETE FROM payslips WHERE run_id = ?', [$run['id']]);
        save_slips($slips);
    });
    audit('payroll_run', $run['id'], 'recompute');
    respond(['ok' => true]);
}

function payroll_advance(array $p): void
{
    $v = new V(req_body());
    $action = $v->enum('action', ['approve', 'pay']);
    $v->done();
    $run = payroll_run_get((int) $p['id']);
    $next = ['approve' => ['draft', 'approved'], 'pay' => ['approved', 'paid']][$action];
    if ($run['status'] !== $next[0]) {
        throw new HttpError(400, "Run must be {$next[0]} to $action");
    }
    // Second approver: when switched on, the person who created the run cannot approve it, and the approver cannot be the one who marks it paid.
    $dual = (bool) q_val('SELECT dual_control FROM payroll_settings WHERE id = 1');
    if ($dual && $action === 'approve' && (int) $run['created_by'] === user()['id']) {
        throw new HttpError(403, 'Second approver needed: the person who created this payroll cannot approve it. Ask another payroll approver.');
    }
    if ($dual && $action === 'pay' && (int) $run['approved_by'] === user()['id']) {
        throw new HttpError(403, 'Second approver needed: the person who approved this payroll cannot also mark it as paid.');
    }
    q_update('payroll_runs', $action === 'approve' ? ['status' => 'approved', 'approved_by' => user()['id'], 'updated_at' => ts()] : ['status' => 'paid', 'paid_by' => user()['id'], 'updated_at' => ts()], 'id = ?', [$run['id']]);
    audit('payroll_run', $run['id'], $action, ['status' => $run['status']], ['status' => $next[1]]);
    if ($action === 'pay') {
        foreach (q_col('SELECT employee_id FROM payslips WHERE run_id = ?', [$run['id']]) as $eid) {
            notify_employee((int) $eid, ['type' => 'payroll', 'title' => 'Your payslip for ' . $run['month'] . ' is ready', 'link' => '/payslips']);
        }
    }
    respond(['ok' => true]);
}

function payroll_delete(array $p): void
{
    $run = payroll_run_get((int) $p['id']);
    if ($run['status'] !== 'draft') {
        throw new HttpError(400, 'Only draft runs can be deleted');
    }
    q_exec('DELETE FROM payslips WHERE run_id = ?', [$run['id']]);
    q_exec('DELETE FROM payroll_runs WHERE id = ?', [$run['id']]);
    audit('payroll_run', $run['id'], 'delete', $run);
    no_content();
}

function payroll_run_payslips(array $p): void
{
    $run = payroll_run_get((int) $p['id']);
    $rows = array_map(fn($r) => cast_fields($r, PAYSLIP_NUM) + ['name' => full_name($r)], q_all(
        'SELECT p.*, e.first_name, e.last_name, e.emp_code FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.first_name',
        [$run['id']]
    ));
    if (($_GET['format'] ?? '') === 'csv') {
        $cols = [['emp_code', 'Code'], ['name', 'Employee'], ['paid_days', 'Paid days'], ['lop_days', 'LOP days'], ['basic', 'Basic'], ['da', 'DA'], ['hra', 'HRA'], ['allowances', 'Special allowance'], ['conveyance', 'Conveyance'], ['travelling_allowance', 'Travelling allowance'], ['medical', 'Medical'], ['other_allowance', 'Other allowance'], ['overtime_hours', 'Overtime hours'], ['overtime_pay', 'Overtime pay'], ['gross', 'Gross'], ['pf_employee', 'PF (employee)'], ['esic_employee', 'ESIC (employee)'], ['professional_tax', 'Professional tax'], ['tds', 'TDS'], ['other_deductions', 'Other deductions'], ['deductions', 'Total deductions'], ['net', 'Net pay'], ['employer_pf', 'Employer PF'], ['employer_edli', 'EDLI'], ['employer_admin', 'PF admin'], ['employer_esic', 'Employer ESIC'], ['gratuity_provision', 'Gratuity provision'], ['employer_cost', 'Employer cost']];
        send_csv('payroll-' . $run['month'] . '.csv', $rows, array_map(fn($c) => ['key' => $c[0], 'label' => $c[1]], $cols));
    }
    respond(['run' => $run, 'payslips' => $rows]);
}

function payslips_mine(): void
{
    if (!user()['employeeId']) {
        respond([]);
    }
    respond(cast_rows(q_all(
        "SELECT p.*, r.month, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('approved','paid') ORDER BY r.month DESC",
        [user()['employeeId']]
    ), PAYSLIP_NUM));
}

function payslip_get(array $p): void
{
    $s = q_one('SELECT p.*, r.month, r.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', [(int) $p['id']]);
    if (!$s) {
        throw new HttpError(404, 'Payslip not found');
    }
    $own = (int) $s['employee_id'] === user()['employeeId'] && in_array($s['status'], ['approved', 'paid'], true);
    if (!$own && !has_perm('payroll.view_all')) {
        throw new HttpError(403, 'Not permitted');
    }
    $e = q_one(
        'SELECT e.*, d.name AS department, g.title AS designation FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN designations g ON g.id = e.designation_id WHERE e.id = ?',
        [(int) $s['employee_id']]
    );
    $lines = array_map(fn($i) => ['name' => $i['name'], 'kind' => $i['kind'], 'amount' => (float) $i['amount']], q_all('SELECT name, kind, amount FROM payslip_items WHERE payslip_id = ? ORDER BY id', [(int) $s['id']]));
    respond(cast_fields($s, PAYSLIP_NUM) + ['items' => $lines, 'employee' => [
        'name' => full_name($e), 'emp_code' => $e['emp_code'], 'department' => $e['department'], 'designation' => $e['designation'], 'join_date' => $e['join_date'],
        'bank_account' => $e['bank_account'] ? '••••' . substr((string) $e['bank_account'], -4) : null,
    ]]);
}

// ---------- salary master (the company's own salary categories) ----------
function comp_shape(array $c): array
{
    return ['id' => (int) $c['id'], 'code' => $c['code'], 'name' => $c['name'], 'kind' => $c['kind'], 'is_standard' => (bool) $c['is_standard'], 'active' => (bool) $c['active'],
        'in_wages' => (bool) $c['in_wages'], 'sort_order' => (int) $c['sort_order'], 'created_at' => $c['created_at'], 'updated_at' => $c['updated_at']];
}

// Only the admin (Super Admin, the one role holding all of these) may change the salary master.
function require_admin(): void
{
    foreach (['user.manage', 'payroll.manage', 'org.manage'] as $k) {
        if (!has_perm($k)) {
            throw new HttpError(403, 'Only the admin can change the salary master');
        }
    }
}

function comp_list(): void
{
    respond(array_map('comp_shape', q_all('SELECT * FROM salary_components ORDER BY sort_order, id')));
}

function comp_slug(string $s): string
{
    $s = trim(preg_replace('/[^a-z0-9]+/', '_', strtolower($s)), '_');
    return substr($s, 0, 30) ?: 'item';
}

function comp_add(): void
{
    require_admin();
    $v = new V(req_body());
    $name = trim($v->str('name', 2, 80));
    $kind = $v->enum('kind', ['earning', 'deduction'], 'earning');
    $inWages = (bool) $v->bool('in_wages');
    $v->done();
    if (q_one('SELECT id FROM salary_components WHERE LOWER(name) = ?', [mb_strtolower($name)])) {
        throw new HttpError(409, 'A category with this name already exists');
    }
    $prefix = $kind === 'deduction' ? 'ded' : 'earn';
    $code = $prefix . '_' . comp_slug($name);
    for ($i = 2; q_one('SELECT id FROM salary_components WHERE code = ?', [$code]); $i++) {
        $code = $prefix . '_' . comp_slug($name) . '_' . $i;
    }
    $last = (int) q_val('SELECT MAX(sort_order) FROM salary_components');
    $id = q_insert('salary_components', [
        'code' => $code, 'name' => $name, 'kind' => $kind, 'in_wages' => ($kind === 'earning' && $inWages) ? 1 : 0, 'is_standard' => 0, 'active' => 1,
        'sort_order' => max($last, 100) + 1, 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('salary_component', $id, 'create', null, ['name' => $name, 'kind' => $kind]);
    respond(['id' => $id], 201);
}

function comp_get(array $p): array
{
    $c = q_one('SELECT * FROM salary_components WHERE id = ?', [(int) $p['id']]);
    if (!$c) {
        throw new HttpError(404, 'Category not found');
    }
    return $c;
}

function comp_update(array $p): void
{
    require_admin();
    $c = comp_get($p);
    $v = new V(req_body());
    $patch = [];
    if ($v->has('name')) { $patch['name'] = trim($v->str('name', 2, 80)); }
    if ($v->has('active')) { $patch['active'] = $v->bool('active') ? 1 : 0; }
    if ($v->has('in_wages') && $c['kind'] === 'earning') { $patch['in_wages'] = $v->bool('in_wages') ? 1 : 0; }
    $v->done();
    if ($c['code'] === 'basic' && isset($patch['active']) && !$patch['active']) {
        throw new HttpError(400, 'Basic salary cannot be switched off');
    }
    if (isset($patch['name']) && q_one('SELECT id FROM salary_components WHERE LOWER(name) = ? AND id <> ?', [mb_strtolower($patch['name']), $c['id']])) {
        throw new HttpError(409, 'A category with this name already exists');
    }
    if ($patch) {
        q_update('salary_components', $patch + ['updated_at' => ts()], 'id = ?', [$c['id']]);
    }
    audit('salary_component', $c['id'], 'update', $c, $patch);
    respond(['ok' => true]);
}

function comp_delete(array $p): void
{
    require_admin();
    $c = comp_get($p);
    if ($c['is_standard']) {
        throw new HttpError(400, 'Standard categories cannot be deleted. Switch them off instead.');
    }
    $used = (int) q_val('SELECT COUNT(*) FROM salary_structure_items WHERE component_id = ? AND amount > 0', [$c['id']]);
    if ($used > 0) {
        throw new HttpError(409, $used . ' salary structure(s) use this category. Switch it off instead, or set it to 0 in those structures first.');
    }
    q_exec('DELETE FROM salary_components WHERE id = ?', [$c['id']]);
    audit('salary_component', $c['id'], 'delete', $c);
    no_content();
}

// ---------- company profile ----------
function company_load(): array
{
    return q_one('SELECT * FROM company_profile WHERE id = 1') ?: ['id' => 1, 'name' => '', 'accent_color' => '#4f46e5'];
}
function company_present(array $c): array
{
    $has = !empty($c['logo_path']);
    unset($c['logo_path']);
    return $c + ['has_logo' => $has];
}
function company_get(): void { respond(company_present(company_load())); }

function company_update(): void
{
    $v = new V(req_body());
    $trim = function ($k, $max) use ($v) {
        $s = $v->optStr($k, $max);
        $s = $s === null ? null : trim($s);
        return $s === '' ? null : $s;
    };
    $name = trim($v->str('name', 0, 150));
    if ($name === '') {
        $v->errors[] = ['code' => 'invalid', 'path' => ['name'], 'message' => 'Required'];
    }
    $d = [
        'name' => $name, 'tagline' => $trim('tagline', 200), 'address' => $trim('address', 400), 'phone' => $trim('phone', 40), 'email' => $trim('email', 150),
        'website' => $trim('website', 150), 'tax_id' => $trim('tax_id', 80),
        'accent_color' => $v->has('accent_color') ? $v->regex('accent_color', '/^#[0-9a-fA-F]{6}$/', 'Colour must look like #4f46e5') : '#4f46e5',
        'signatory_name' => $trim('signatory_name', 100), 'signatory_title' => $trim('signatory_title', 100), 'payslip_footer' => $trim('payslip_footer', 400),
    ];
    $v->done();
    $before = company_load();
    if (q_one('SELECT id FROM company_profile WHERE id = 1')) {
        q_update('company_profile', $d + ['updated_at' => ts()], 'id = 1');
    } else {
        q_insert('company_profile', $d + ['id' => 1, 'created_at' => ts(), 'updated_at' => ts()]);
    }
    audit('company_profile', 1, 'update', company_present($before), $d);
    respond(company_present(company_load()));
}

function company_logo_set(): void
{
    require_admin();
    $f = upload_error_check('file', 2 * 1024 * 1024, 'Logo must be 2 MB or smaller');
    $insp = upload_inspect($f['tmp_name'], (string) $f['name'], ['png', 'jpg']);
    $mime = $insp['mime'];
    $before = company_load();
    $saved = save_upload($f, 'company', $insp['ext']);
    $patch = ['logo_path' => $saved['rel'], 'logo_mime' => $mime, 'updated_at' => ts()];
    if (q_one('SELECT id FROM company_profile WHERE id = 1')) {
        q_update('company_profile', $patch, 'id = 1');
    } else {
        q_insert('company_profile', $patch + ['id' => 1, 'name' => '', 'created_at' => ts()]);
    }
    if (!empty($before['logo_path'])) {
        @unlink(uploads_root() . '/' . $before['logo_path']);
    }
    audit('company_profile', 1, 'logo_upload');
    respond(company_present(company_load()));
}

function company_logo_delete(): void
{
    require_admin();
    $before = company_load();
    q_update('company_profile', ['logo_path' => null, 'logo_mime' => null, 'updated_at' => ts()], 'id = 1');
    if (!empty($before['logo_path'])) {
        @unlink(uploads_root() . '/' . $before['logo_path']);
    }
    audit('company_profile', 1, 'logo_delete');
    respond(company_present(company_load()));
}

function company_logo_get(): void
{
    header('Cache-Control: no-cache');
    $c = company_load();
    if (empty($c['logo_path'])) {
        throw new HttpError(404, 'No logo');
    }
    send_stored_file($c['logo_path'], 'logo', (string) ($c['logo_mime'] ?: 'image/png'), true);
}
