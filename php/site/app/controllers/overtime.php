<?php
// Overtime: the company policy (Master sheet), employee claims, approval, and the pay that payroll adds to the payslip.
// Mirrors server/src/controllers/overtime.js and server/src/services/overtime.js.

function ot_policy(): array
{
    $p = q_one('SELECT * FROM overtime_settings WHERE id = 1');
    $out = ['enabled' => (bool) $p['enabled'], 'basis' => $p['basis'], 'min_minutes' => (int) $p['min_minutes'], 'max_back_days' => (int) $p['max_back_days'], 'id' => 1];
    foreach (['hours_per_day', 'days_per_month', 'rate_weekday', 'rate_weekoff', 'rate_holiday', 'max_hours_day', 'max_hours_month'] as $k) {
        $out[$k] = (float) $p[$k];
    }
    return $out;
}

function ot_day_type(array $emp, string $date): string
{
    if (isset(holiday_map($date, $date)[$date])) {
        return 'holiday';
    }
    return in_array(day_of_week($date), weekoff_set(shift_for($emp)), true) ? 'weekoff' : 'weekday';
}

function ot_multiplier(array $policy, string $dayType): float
{
    return ['weekday' => $policy['rate_weekday'], 'weekoff' => $policy['rate_weekoff'], 'holiday' => $policy['rate_holiday']][$dayType] ?? $policy['rate_weekday'];
}

// Ordinary pay for one hour from a full-month salary structure. $off = standard codes switched off; $custom = [['amount' => ..]].
function ot_hourly_rate(array $s, array $policy, array $off = [], array $custom = []): float
{
    $v = fn(string $k) => in_array($k, $off, true) ? 0.0 : (float) ($s[$k] ?? 0);
    $basic = $v('basic');
    if ($policy['basis'] === 'basic') {
        $base = $basic;
    } elseif ($policy['basis'] === 'gross') {
        $base = $basic + $v('da') + $v('hra') + $v('allowances') + $v('conveyance') + $v('travelling_allowance') + $v('medical') + $v('other_allowance') + array_sum(array_map(fn($c) => (float) $c['amount'], $custom));
    } else {
        $base = $basic + $v('da');
    }
    $per = ($policy['days_per_month'] ?: 26) * ($policy['hours_per_day'] ?: 8);
    return $per > 0 ? $base / $per : 0.0;
}

function ot_pay($hours, $rate, float $perHour): float { return r2((float) $hours * (float) $rate * $perHour); }

// Approved overtime in a month for one employee: ['hours' => , 'pay' => ].
function ot_approved_for(int $employeeId, string $from, string $to, float $perHour): array
{
    $hours = 0.0;
    $pay = 0.0;
    foreach (q_all("SELECT hours, rate FROM overtime_requests WHERE employee_id = ? AND status = 'approved' AND date BETWEEN ? AND ?", [$employeeId, $from, $to]) as $r) {
        $hours += (float) $r['hours'];
        $pay += ot_pay($r['hours'], $r['rate'], $perHour);
    }
    return ['hours' => r2($hours), 'pay' => r2($pay)];
}

function ot_per_hour_for(int $employeeId, string $date, array $policy): array
{
    $s = current_structure($employeeId, $date);
    if (!$s) {
        return [null, 0.0];
    }
    $comps = q_all('SELECT * FROM salary_components');
    $off = array_values(array_map(fn($c) => $c['code'], array_filter($comps, fn($c) => $c['is_standard'] && !$c['active'])));
    $live = [];
    foreach ($comps as $c) {
        if (!$c['is_standard'] && $c['active'] && $c['kind'] === 'earning') {
            $live[(int) $c['id']] = true;
        }
    }
    $items = array_values(array_filter(q_all('SELECT component_id, amount FROM salary_structure_items WHERE structure_id = ?', [$s['id']]), fn($i) => isset($live[(int) $i['component_id']])));
    return [$s, ot_hourly_rate($s, $policy, $off, $items)];
}

function ot_month_closed(string $date): bool
{
    return (bool) q_one("SELECT id FROM payroll_runs WHERE month = ? AND status != 'draft'", [substr($date, 0, 7)]);
}

function ot_settings_get(): void { respond(ot_policy()); }

function ot_settings_update(): void
{
    require_admin();
    $v = new V(req_body());
    $d = ['enabled' => $v->bool('enabled') ? 1 : 0, 'basis' => $v->enum('basis', ['basic', 'basic_da', 'gross'])];
    $d['hours_per_day'] = $v->num('hours_per_day', 1, 24);
    $d['days_per_month'] = $v->num('days_per_month', 1, 31);
    $d['rate_weekday'] = $v->num('rate_weekday', 1, 5);
    $d['rate_weekoff'] = $v->num('rate_weekoff', 1, 5);
    $d['rate_holiday'] = $v->num('rate_holiday', 1, 5);
    $d['min_minutes'] = (int) $v->num('min_minutes', 0, 480);
    $d['max_hours_day'] = $v->num('max_hours_day', 0.5, 24);
    $d['max_hours_month'] = $v->num('max_hours_month', 1, 300);
    $d['max_back_days'] = (int) $v->num('max_back_days', 0, 60);
    $v->done();
    $before = ot_policy();
    q_update('overtime_settings', $d + ['updated_at' => ts()], 'id = ?', [1]);
    audit('overtime_settings', 1, 'update', $before, $d);
    respond(ot_policy());
}

function ot_create(): void
{
    $v = new V(req_body());
    $date = $v->date('date');
    $start = $v->time('start_time');
    $end = $v->time('end_time');
    $reason = $v->str('reason', 3, 255);
    $v->done();
    $emp = get_employee(require_employee());
    $policy = ot_policy();
    if (!$policy['enabled']) {
        throw new HttpError(400, 'Overtime is switched off for this company');
    }
    [$s] = ot_per_hour_for((int) $emp['id'], $date, $policy);
    if ($s && !(int) $s['overtime_eligible']) {
        throw new HttpError(403, 'Your salary structure is not eligible for overtime');
    }
    if ($date > today()) {
        throw new HttpError(400, 'Overtime can only be claimed once the work is done');
    }
    if ($date < add_days(today(), -$policy['max_back_days'])) {
        throw new HttpError(400, "Overtime must be claimed within {$policy['max_back_days']} day(s) of the work");
    }
    if ($date < substr((string) $emp['join_date'], 0, 10)) {
        throw new HttpError(400, 'Date is before your joining date');
    }
    if (to_minutes($end) <= to_minutes($start)) {
        throw new HttpError(400, 'End time must be after start time');
    }
    $hours = r2((to_minutes($end) - to_minutes($start)) / 60);
    if ($hours * 60 < $policy['min_minutes']) {
        throw new HttpError(400, "Overtime must be at least {$policy['min_minutes']} minutes");
    }
    if (ot_month_closed($date)) {
        throw new HttpError(400, 'Payroll for that month is already approved, so overtime can no longer be added');
    }
    $live = q_all("SELECT * FROM overtime_requests WHERE employee_id = ? AND status IN ('pending','approved')", [$emp['id']]);
    $dayTotal = $hours;
    $monthTotal = $hours;
    foreach ($live as $r) {
        $rd = substr((string) $r['date'], 0, 10);
        if ($rd === $date) {
            if (to_minutes($start) < to_minutes($r['end_time']) && to_minutes($end) > to_minutes($r['start_time'])) {
                throw new HttpError(409, 'This overlaps an overtime request you already made for that day');
            }
            $dayTotal += (float) $r['hours'];
        }
        if (substr($rd, 0, 7) === substr($date, 0, 7)) {
            $monthTotal += (float) $r['hours'];
        }
    }
    if ($dayTotal > $policy['max_hours_day']) {
        throw new HttpError(400, "Overtime is limited to {$policy['max_hours_day']} hour(s) a day");
    }
    if ($monthTotal > $policy['max_hours_month']) {
        throw new HttpError(400, "Overtime is limited to {$policy['max_hours_month']} hour(s) a month");
    }
    $dayType = ot_day_type($emp, $date);
    $id = q_insert('overtime_requests', [
        'employee_id' => $emp['id'], 'date' => $date, 'start_time' => $start, 'end_time' => $end, 'hours' => $hours, 'day_type' => $dayType,
        'rate' => ot_multiplier($policy, $dayType), 'reason' => $reason, 'status' => 'pending', 'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('overtime', $id, 'create', null, compact('date', 'start', 'end', 'reason') + ['hours' => $hours]);
    notify_approvers($emp, ['type' => 'overtime', 'title' => full_name($emp) . " requested $hours hour(s) of overtime", 'body' => "$date: $reason", 'link' => '/approvals'], 'attendance.manage');
    respond(['id' => $id, 'hours' => $hours, 'day_type' => $dayType], 201);
}

function ot_list(): void
{
    $scope = $_GET['scope'] ?? 'mine';
    $where = [];
    $p = [];
    if (!empty($_GET['status'])) { $where[] = 'r.status = ?'; $p[] = (string) $_GET['status']; }
    if (is_month_str($_GET['month'] ?? null)) {
        $mr = month_range($_GET['month']);
        $where[] = 'r.date BETWEEN ? AND ?';
        $p[] = $mr['from'];
        $p[] = $mr['to'];
    }
    if ($scope === 'mine') {
        $where[] = 'r.employee_id = ?';
        $p[] = require_employee();
    } else {
        if (!has_perm('attendance.view_team') && !has_perm('attendance.manage')) {
            throw new HttpError(403, 'Not permitted');
        }
        $ids = visible_ids('attendance.manage');
        if ($ids !== null) { $where[] = 'r.employee_id IN (' . marks($ids) . ')'; $p = array_merge($p, $ids); }
        $where[] = 'r.employee_id != ?';
        $p[] = user()['employeeId'] ?: 0;
    }
    $rows = q_all(
        'SELECT r.*, e.first_name, e.last_name, e.emp_code FROM overtime_requests r JOIN employees e ON e.id = r.employee_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY r.date DESC, r.id DESC LIMIT 300',
        $p
    );
    $policy = ot_policy();
    $perHour = [];
    $out = [];
    foreach ($rows as $r) {
        $date = substr((string) $r['date'], 0, 10);
        $eid = (int) $r['employee_id'];
        if (!isset($perHour[$eid])) {
            $perHour[$eid] = ot_per_hour_for($eid, $date, $policy)[1];
        }
        $rate = $r['status'] === 'approved' ? (float) $r['rate'] : ot_multiplier($policy, $r['day_type']);
        $out[] = array_merge($r, ['date' => $date, 'name' => full_name($r), 'hours' => (float) $r['hours'], 'rate' => $rate, 'pay' => ot_pay($r['hours'], $rate, $perHour[$eid])]);
    }
    respond($out);
}

function ot_decide(array $p): void
{
    $v = new V(req_body());
    $action = $v->enum('action', ['approve', 'reject', 'cancel']);
    $note = $v->optStr('note', 255);
    $v->done();
    $r = q_one('SELECT * FROM overtime_requests WHERE id = ?', [(int) $p['id']]);
    if (!$r) {
        throw new HttpError(404, 'Request not found');
    }
    $date = substr((string) $r['date'], 0, 10);
    if ($action === 'cancel') {
        if ((int) $r['employee_id'] !== user()['employeeId']) {
            throw new HttpError(403, 'Only the person who made the request can cancel it');
        }
        if (!in_array($r['status'], ['pending', 'approved'], true)) {
            throw new HttpError(400, 'This request can no longer be cancelled');
        }
        if ($r['status'] === 'approved' && ot_month_closed($date)) {
            throw new HttpError(400, 'Payroll for that month is already approved, so this can no longer be cancelled');
        }
        q_update('overtime_requests', ['status' => 'cancelled', 'updated_at' => ts()], 'id = ?', [$r['id']]);
        audit('overtime', $r['id'], 'cancel', ['status' => $r['status']], ['status' => 'cancelled']);
        respond(['ok' => true]);
    }
    if (!has_perm('attendance.view_team') && !has_perm('attendance.manage')) {
        throw new HttpError(403, 'Not permitted');
    }
    if ($r['status'] !== 'pending') {
        throw new HttpError(400, 'Already decided');
    }
    if ((int) $r['employee_id'] === user()['employeeId']) {
        throw new HttpError(403, 'You cannot approve your own request');
    }
    assert_access((int) $r['employee_id'], 'attendance.manage');
    if ($action === 'approve' && ot_month_closed($date)) {
        throw new HttpError(400, 'Payroll for that month is already approved, so overtime can no longer be approved');
    }
    $policy = ot_policy();
    $patch = ['status' => $action === 'approve' ? 'approved' : 'rejected', 'approver_id' => user()['id'], 'decision_note' => $note, 'decided_at' => ts(), 'updated_at' => ts()];
    if ($action === 'approve') {
        $patch['rate'] = ot_multiplier($policy, $r['day_type']);
    }
    q_update('overtime_requests', $patch, 'id = ?', [$r['id']]);
    audit('overtime', $r['id'], $action, ['status' => 'pending'], ['status' => $patch['status']]);
    notify_employee((int) $r['employee_id'], ['type' => 'overtime', 'title' => "Your overtime for $date was " . ($action === 'approve' ? 'approved' : 'rejected'), 'body' => $note, 'link' => '/overtime']);
    respond(['ok' => true]);
}

function ot_summary(): void
{
    $month = is_month_str($_GET['month'] ?? null) ? $_GET['month'] : current_month();
    $empId = (int) ($_GET['employeeId'] ?? 0) ?: require_employee();
    if ($empId !== user()['employeeId']) {
        assert_access($empId, 'payroll.view_all');
    }
    $policy = ot_policy();
    $mr = month_range($month);
    [$s, $perHour] = ot_per_hour_for($empId, $mr['to'], $policy);
    $rows = q_all('SELECT * FROM overtime_requests WHERE employee_id = ? AND date BETWEEN ? AND ?', [$empId, $mr['from'], $mr['to']]);
    $sum = fn(string $st) => r2(array_sum(array_map(fn($r) => (float) $r['hours'], array_filter($rows, fn($r) => $r['status'] === $st))));
    $pay = r2(array_sum(array_map(fn($r) => ot_pay($r['hours'], $r['rate'], $perHour), array_filter($rows, fn($r) => $r['status'] === 'approved'))));
    respond([
        'month' => $month, 'enabled' => $policy['enabled'], 'eligible' => $policy['enabled'] && $s && (int) $s['overtime_eligible'] === 1, 'has_salary' => (bool) $s,
        'hours_approved' => $sum('approved'), 'hours_pending' => $sum('pending'), 'pay_approved' => $pay, 'per_hour' => r2($perHour),
        'hours_left' => max(0, r2($policy['max_hours_month'] - $sum('approved') - $sum('pending'))), 'max_hours_month' => $policy['max_hours_month'],
    ]);
}

// Overtime made from the punch times: work beyond the shift end (or any work on a weekly off or holiday) becomes a pending claim.
// A person who already made their own claim for the day is left alone. The manager still approves it.
function ot_auto(array $emp, string $date): void
{
    $rules = att_rules();
    $policy = ot_policy();
    if (!$rules['auto_overtime'] || !$policy['enabled']) {
        return;
    }
    $rec = q_one('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]);
    if (!$rec || !$rec['check_in'] || !$rec['check_out']) {
        return;
    }
    [$s] = ot_per_hour_for((int) $emp['id'], $date, $policy);
    if (!$s || empty($s['overtime_eligible']) || ot_month_closed($date) || $date < substr((string) $emp['join_date'], 0, 10)) {
        return;
    }
    $live = q_all("SELECT * FROM overtime_requests WHERE employee_id = ? AND date = ? AND status IN ('pending','approved')", [$emp['id'], $date]);
    foreach ($live as $r) {
        if ($r['source'] !== 'auto' || $r['status'] === 'approved') {
            return;
        }
    }
    q_run("DELETE FROM overtime_requests WHERE employee_id = ? AND date = ? AND source = 'auto' AND status = 'pending'", [$emp['id'], $date]);
    $dayType = ot_day_type($emp, $date);
    $shift = shift_for($emp);
    $inMin = local_parts(parse_ts($rec['check_in']))['minutes'];
    $outMin = local_parts(parse_ts($rec['check_out']))['minutes'];
    $startMin = $dayType === 'weekday' ? max(to_minutes($shift['end_time']), $inMin) : $inMin;
    $mins = $outMin - $startMin;
    $month = substr($date, 0, 7);
    $used = 0.0;
    foreach (q_all("SELECT hours FROM overtime_requests WHERE employee_id = ? AND status IN ('pending','approved') AND date BETWEEN ? AND ?", [$emp['id'], $month . '-01', $month . '-31']) as $r) {
        $used += (float) $r['hours'];
    }
    $mins = min($mins, (int) round($policy['max_hours_day'] * 60), (int) round(($policy['max_hours_month'] - $used) * 60));
    if ($mins < max($rules['auto_overtime_min'], $policy['min_minutes'], 1)) {
        return;
    }
    $hours = r2($mins / 60);
    $hm = fn(int $m) => sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    q_insert('overtime_requests', [
        'employee_id' => $emp['id'], 'date' => $date, 'start_time' => $hm($startMin), 'end_time' => $hm($startMin + $mins), 'hours' => $hours, 'day_type' => $dayType,
        'rate' => ot_multiplier($policy, $dayType), 'reason' => 'Worked beyond shift end (worked out from the punch times)', 'status' => 'pending', 'source' => 'auto',
        'created_at' => ts(), 'updated_at' => ts(),
    ]);
    notify_approvers($emp, ['type' => 'overtime', 'title' => full_name($emp) . " has $hours hour(s) of overtime from the punch times", 'body' => "$date: please check and approve", 'link' => '/approvals'], 'attendance.manage');
}
