<?php
// Attendance (check-in/out, calendar, team view, regularization) and leave (balances, requests, approvals).

// ---------- attendance ----------
function att_check_in(): void
{
    $emp = get_employee(require_employee());
    $date = today();
    $existing = q_one('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]);
    if ($existing && $existing['check_in']) {
        throw new HttpError(400, 'You have already checked in today');
    }
    $rules = att_rules();
    $source = att_punch_source($rules); // a QR code from the office screen, when the company asks for one
    $where = geo_verify_punch('in'); // refuses the punch when the location check is on and you are not at the office
    $photo = att_save_selfie(req_body()['photo'] ?? null, $rules['selfie_required']);
    $now = ts();
    $calc = evaluate_day(shift_for($emp), $now, null, $rules);
    q_insert('attendance', ['employee_id' => $emp['id'], 'date' => $date, 'check_in' => $now, 'source' => $source, 'status' => $calc['status'], 'late_minutes' => $calc['late_minutes'], 'in_photo' => $photo, 'created_at' => ts(), 'updated_at' => ts()] + $where);
    respond(q_one('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]), 201);
}

function att_check_out(): void
{
    $emp = get_employee(require_employee());
    $date = today();
    $rec = q_one('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]);
    if (!$rec || !$rec['check_in']) {
        throw new HttpError(400, 'Check in first');
    }
    if ($rec['check_out']) {
        throw new HttpError(400, 'You have already checked out today');
    }
    $rules = att_rules();
    att_punch_source($rules);
    $where = geo_verify_punch('out');
    $photo = att_save_selfie(req_body()['photo'] ?? null, false);
    $now = ts();
    $calc = evaluate_day(shift_for($emp), $rec['check_in'], $now, $rules);
    q_update('attendance', ['check_out' => $now, 'out_photo' => $photo] + $calc + $where + ['updated_at' => ts()], 'id = ?', [$rec['id']]);
    ot_auto($emp, $date);
    respond(q_one('SELECT * FROM attendance WHERE id = ?', [$rec['id']]));
}

function att_today(): void
{
    $emp = get_employee(require_employee());
    $day = day_statuses($emp, today(), today())[0];
    respond($day + ['shift' => shift_for($emp)]);
}

function att_calendar(): void
{
    $month = $_GET['month'] ?? current_month();
    if (!is_month_str($month)) {
        throw new HttpError(400, 'Invalid month');
    }
    $empId = (int) ($_GET['employeeId'] ?? 0) ?: (int) user()['employeeId'];
    if (!$empId) {
        throw new HttpError(400, 'No employee selected');
    }
    assert_access($empId, 'attendance.view_all');
    $emp = get_employee($empId);
    $r = month_range($month);
    $days = day_statuses($emp, $r['from'], $r['to']);
    $summary = ['present' => 0, 'half_day' => 0, 'absent' => 0, 'leave' => 0, 'late' => 0, 'worked_minutes' => 0];
    foreach ($days as $d) {
        if ($d['status'] === 'present') { $summary['present']++; }
        if ($d['status'] === 'half_day') { $summary['half_day']++; }
        if ($d['status'] === 'absent') { $summary['absent']++; }
        if ($d['status'] === 'leave') { $summary['leave'] += 1; }
        if ($d['status'] === 'half_leave') { $summary['leave'] += 0.5; }
        if (!empty($d['record']['late_minutes'])) { $summary['late']++; }
        $summary['worked_minutes'] += (int) ($d['record']['worked_minutes'] ?? 0);
    }
    respond(['employee' => ['id' => $emp['id'], 'name' => full_name($emp), 'emp_code' => $emp['emp_code']], 'month' => $month, 'summary' => $summary, 'days' => $days]);
}

function att_team(): void
{
    $date = $_GET['date'] ?? today();
    if (!is_date_str($date)) {
        throw new HttpError(400, 'Invalid date');
    }
    $ids = visible_ids('attendance.view_all');
    $sql = "SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited'";
    $p = [];
    if ($ids !== null) {
        $sql .= ' AND e.id IN (' . marks($ids) . ')';
        $p = $ids;
    }
    $rows = [];
    foreach (q_all($sql . ' ORDER BY e.first_name', $p) as $e) {
        $day = day_statuses($e, $date, $date)[0];
        $rows[] = [
            'id' => $e['id'], 'name' => full_name($e), 'emp_code' => $e['emp_code'], 'department' => $e['department'], 'status' => $day['status'],
            'check_in' => $day['record']['check_in'] ?? null, 'check_out' => $day['record']['check_out'] ?? null,
            'late_minutes' => (int) ($day['record']['late_minutes'] ?? 0), 'leave' => $day['leave'] ? $day['leave']['type_name'] : null,
        ];
    }
    respond(['date' => $date, 'rows' => $rows]);
}

function att_reg_create(): void
{
    $v = new V(req_body());
    $date = $v->date('date');
    $in = $v->time('requested_in');
    $out = $v->time('requested_out');
    $reason = $v->str('reason', 3, 255);
    $v->done();
    $emp = get_employee(require_employee());
    if ($date > today()) {
        throw new HttpError(400, 'Cannot regularize a future date');
    }
    if ($out <= $in) {
        throw new HttpError(400, 'Check-out must be after check-in');
    }
    if (q_one('SELECT id FROM attendance_regularizations WHERE employee_id = ? AND date = ? AND status = ?', [$emp['id'], $date, 'pending'])) {
        throw new HttpError(409, 'A request for this date is already pending');
    }
    $id = q_insert('attendance_regularizations', ['employee_id' => $emp['id'], 'date' => $date, 'requested_in' => $in, 'requested_out' => $out, 'reason' => $reason, 'created_at' => ts(), 'updated_at' => ts()]);
    audit('regularization', $id, 'create', null, compact('date', 'reason') + ['requested_in' => $in, 'requested_out' => $out]);
    notify_approvers($emp, ['type' => 'regularization', 'title' => full_name($emp) . ' requested attendance regularization', 'body' => "$date: $reason", 'link' => '/approvals'], 'attendance.manage');
    respond(['id' => $id], 201);
}

function att_reg_list(): void
{
    $scope = $_GET['scope'] ?? 'mine';
    $where = [];
    $p = [];
    if (!empty($_GET['status'])) { $where[] = 'r.status = ?'; $p[] = (string) $_GET['status']; }
    if ($scope === 'mine') {
        $where[] = 'r.employee_id = ?';
        $p[] = require_employee();
    } else {
        $ids = visible_ids('attendance.manage');
        if ($ids !== null) { $where[] = 'r.employee_id IN (' . marks($ids) . ')'; $p = array_merge($p, $ids); }
        $where[] = 'r.employee_id != ?';
        $p[] = user()['employeeId'] ?: 0;
    }
    $rows = q_all(
        'SELECT r.*, e.first_name, e.last_name, e.emp_code FROM attendance_regularizations r JOIN employees e ON e.id = r.employee_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY r.id DESC LIMIT 200',
        $p
    );
    respond(array_map(fn($r) => $r + ['name' => full_name($r)], $rows));
}

function att_reg_decide(array $p): void
{
    $v = new V(req_body());
    $action = $v->enum('action', ['approve', 'reject']);
    $note = $v->optStr('note', 255);
    $v->done();
    $reg = q_one('SELECT * FROM attendance_regularizations WHERE id = ?', [(int) $p['id']]);
    if (!$reg) {
        throw new HttpError(404, 'Request not found');
    }
    if ($reg['status'] !== 'pending') {
        throw new HttpError(400, 'Already decided');
    }
    if ((int) $reg['employee_id'] === user()['employeeId']) {
        throw new HttpError(403, 'You cannot approve your own request');
    }
    assert_access((int) $reg['employee_id'], 'attendance.manage');
    $emp = get_employee((int) $reg['employee_id']);
    $date = substr((string) $reg['date'], 0, 10);
    $shift = shift_for($emp);
    $rules = att_rules();
    in_transaction(function () use ($reg, $action, $note, $emp, $date, $shift, $rules) {
        q_update('attendance_regularizations', [
            'status' => $action === 'approve' ? 'approved' : 'rejected', 'approver_id' => user()['id'], 'decision_note' => $note, 'decided_at' => ts(), 'updated_at' => ts(),
        ], 'id = ?', [$reg['id']]);
        if ($action === 'approve') {
            $in = local_to_ts($date, $reg['requested_in']);
            $out = local_to_ts($date, $reg['requested_out']);
            $row = ['check_in' => $in, 'check_out' => $out, 'source' => 'regularized'] + evaluate_day($shift, $in, $out, $rules);
            $existing = q_one('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]);
            if ($existing) {
                q_update('attendance', $row + ['updated_at' => ts()], 'id = ?', [$existing['id']]);
            } else {
                q_insert('attendance', $row + ['employee_id' => $emp['id'], 'date' => $date, 'created_at' => ts(), 'updated_at' => ts()]);
            }
        }
    });
    audit('regularization', $reg['id'], $action, ['status' => 'pending'], ['status' => $action]);
    notify_employee((int) $emp['id'], ['type' => 'regularization', 'title' => "Your regularization for $date was " . ($action === 'approve' ? 'approved' : 'rejected'), 'body' => $note, 'link' => '/attendance']);
    respond(['ok' => true]);
}

// ---------- leave ----------
function leave_balances(): void
{
    $empId = (int) ($_GET['employeeId'] ?? 0) ?: (int) user()['employeeId'];
    if (!$empId) {
        throw new HttpError(400, 'No employee selected');
    }
    assert_access($empId, 'leave.view_all');
    $emp = get_employee($empId);
    $year = (int) ($_GET['year'] ?? 0) ?: (int) substr(today(), 0, 4);
    $out = [];
    foreach (q_all("SELECT * FROM leave_types WHERE status = 'active' ORDER BY id") as $t) {
        $b = ensure_balance($emp, $t, $year);
        $out[] = [
            'leave_type_id' => $t['id'], 'name' => $t['name'], 'code' => $t['code'], 'color' => $t['color'], 'is_paid' => (bool) $t['is_paid'], 'year' => $year,
            'opening' => (float) $b['opening'], 'accrued' => (float) $b['accrued'], 'used' => (float) $b['used'], 'available' => leave_available($b), 'unlimited' => (float) $t['annual_quota'] == 0.0,
        ];
    }
    respond($out);
}

function leave_apply(): void
{
    $v = new V(req_body());
    $typeId = $v->int('leave_type_id');
    $from = $v->date('from_date');
    $to = $v->date('to_date');
    $part = $v->enum('day_part', ['full', 'first_half', 'second_half'], 'full');
    $reason = $v->str('reason', 3, 255);
    $v->done();
    $emp = get_employee(require_employee());
    $type = q_one("SELECT * FROM leave_types WHERE id = ? AND status = 'active'", [$typeId]);
    if (!$type) {
        throw new HttpError(400, 'Unknown leave type');
    }
    if ($from < substr((string) $emp['join_date'], 0, 10)) {
        throw new HttpError(400, 'Leave cannot start before your joining date');
    }
    if (substr($from, 0, 4) !== substr($to, 0, 4)) {
        throw new HttpError(400, 'Split requests that cross a year boundary');
    }
    $days = count_leave_days($emp, $type, $from, $to, $part);
    $overlap = q_one(
        "SELECT * FROM leave_requests WHERE employee_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ? LIMIT 1",
        [$emp['id'], $to, $from]
    );
    if ($overlap) {
        $bothHalf = $overlap['day_part'] !== 'full' && $part !== 'full' && $overlap['day_part'] !== $part && substr((string) $overlap['from_date'], 0, 10) === $from;
        if (!$bothHalf) {
            throw new HttpError(409, 'You already have leave on some of these dates');
        }
    }
    if ((float) $type['annual_quota'] > 0) {
        $bal = ensure_balance($emp, $type, (int) substr($from, 0, 4));
        $pending = (float) q_val("SELECT COALESCE(SUM(days), 0) FROM leave_requests WHERE employee_id = ? AND leave_type_id = ? AND status = 'pending'", [$emp['id'], $type['id']]);
        if (leave_available($bal) - $pending < $days) {
            throw new HttpError(400, 'Insufficient ' . $type['name'] . ' balance');
        }
    }
    $id = q_insert('leave_requests', [
        'leave_type_id' => $typeId, 'from_date' => $from, 'to_date' => $to, 'day_part' => $part, 'reason' => $reason, 'employee_id' => $emp['id'], 'days' => $days,
        'created_at' => ts(), 'updated_at' => ts(),
    ]);
    audit('leave_request', $id, 'create', null, ['leave_type_id' => $typeId, 'from_date' => $from, 'to_date' => $to, 'day_part' => $part, 'reason' => $reason, 'days' => $days]);
    notify_approvers($emp, ['type' => 'leave', 'title' => full_name($emp) . " applied for $days day(s) of " . $type['name'], 'body' => "$from to $to: $reason", 'link' => '/approvals']);
    respond(['id' => $id, 'days' => $days], 201);
}

function leave_list(): void
{
    $scope = $_GET['scope'] ?? 'mine';
    $where = [];
    $p = [];
    if (!empty($_GET['status'])) { $where[] = 'l.status = ?'; $p[] = (string) $_GET['status']; }
    if ($scope === 'mine') {
        $where[] = 'l.employee_id = ?';
        $p[] = require_employee();
    } else {
        $ids = visible_ids($scope === 'all' ? 'leave.view_all' : 'leave.manage');
        if ($scope === 'team' && !has_perm('leave.approve')) {
            throw new HttpError(403, 'Not permitted');
        }
        if ($ids !== null) { $where[] = 'l.employee_id IN (' . marks($ids) . ')'; $p = array_merge($p, $ids); }
        if ($scope === 'team') { $where[] = 'l.employee_id != ?'; $p[] = user()['employeeId'] ?: 0; }
    }
    $rows = q_all(
        'SELECT l.*, e.first_name, e.last_name, e.emp_code, t.name AS type_name, t.code, t.color FROM leave_requests l
         JOIN employees e ON e.id = l.employee_id JOIN leave_types t ON t.id = l.leave_type_id'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY l.id DESC LIMIT 300',
        $p
    );
    respond(array_map(fn($r) => cast_fields($r, ['days']) + ['name' => full_name($r)], $rows));
}

function leave_decide(array $p): void
{
    $v = new V(req_body());
    $action = $v->enum('action', ['approve', 'reject', 'cancel']);
    $note = $v->optStr('note', 255);
    $v->done();
    $lr = q_one('SELECT * FROM leave_requests WHERE id = ?', [(int) $p['id']]);
    if (!$lr) {
        throw new HttpError(404, 'Request not found');
    }
    $emp = get_employee((int) $lr['employee_id']);
    $type = q_one('SELECT * FROM leave_types WHERE id = ?', [(int) $lr['leave_type_id']]);
    $from = substr((string) $lr['from_date'], 0, 10);
    $year = (int) substr($from, 0, 4);

    if ($action === 'cancel') {
        if ((int) $lr['employee_id'] !== user()['employeeId'] && !has_perm('leave.manage')) {
            throw new HttpError(403, 'Not permitted');
        }
        if (!in_array($lr['status'], ['pending', 'approved'], true)) {
            throw new HttpError(400, 'Request cannot be cancelled');
        }
        if ($lr['status'] === 'approved' && $from < today() && !has_perm('leave.manage')) {
            throw new HttpError(400, 'Past leave cannot be cancelled');
        }
        in_transaction(function () use ($lr, $emp, $type, $year) {
            if ($lr['status'] === 'approved') {
                $b = ensure_balance($emp, $type, $year);
                q_update('leave_balances', ['used' => max(0, (float) $b['used'] - (float) $lr['days'])], 'id = ?', [$b['id']]);
            }
            q_update('leave_requests', ['status' => 'cancelled', 'decided_at' => ts(), 'updated_at' => ts()], 'id = ?', [$lr['id']]);
        });
        audit('leave_request', $lr['id'], 'cancel', ['status' => $lr['status']], ['status' => 'cancelled']);
        if ((int) $lr['employee_id'] !== user()['employeeId']) {
            notify_employee((int) $emp['id'], ['type' => 'leave', 'title' => 'Your ' . $type['name'] . ' request was cancelled by HR', 'body' => $note, 'link' => '/leave']);
        }
        respond(['ok' => true]);
    }

    if ($lr['status'] !== 'pending') {
        throw new HttpError(400, 'Already decided');
    }
    if ((int) $lr['employee_id'] === user()['employeeId']) {
        throw new HttpError(403, 'You cannot approve your own request');
    }
    if (!has_perm('leave.approve')) {
        throw new HttpError(403, 'Not permitted');
    }
    assert_access((int) $lr['employee_id'], 'leave.manage');
    in_transaction(function () use ($lr, $emp, $type, $year, $action, $note) {
        if ($action === 'approve') {
            $b = ensure_balance($emp, $type, $year);
            if ((float) $type['annual_quota'] > 0 && leave_available($b) < (float) $lr['days']) {
                throw new HttpError(400, 'Employee no longer has enough balance');
            }
            q_update('leave_balances', ['used' => (float) $b['used'] + (float) $lr['days']], 'id = ?', [$b['id']]);
        }
        q_update('leave_requests', [
            'status' => $action === 'approve' ? 'approved' : 'rejected', 'approver_id' => user()['id'], 'decision_note' => $note, 'decided_at' => ts(), 'updated_at' => ts(),
        ], 'id = ?', [$lr['id']]);
    });
    audit('leave_request', $lr['id'], $action, ['status' => 'pending'], ['status' => $action]);
    notify_employee((int) $emp['id'], ['type' => 'leave', 'title' => 'Your ' . $type['name'] . " request ($from) was " . ($action === 'approve' ? 'approved' : 'rejected'), 'body' => $note, 'link' => '/leave']);
    respond(['ok' => true]);
}

function leave_calendar(): void
{
    $month = $_GET['month'] ?? current_month();
    if (!is_month_str($month)) {
        throw new HttpError(400, 'Invalid month');
    }
    $r = month_range($month);
    $ids = visible_ids('leave.view_all');
    $sql = "SELECT l.id, l.employee_id, l.from_date, l.to_date, l.day_part, e.first_name, e.last_name, t.name AS type_name, t.color FROM leave_requests l
            JOIN employees e ON e.id = l.employee_id JOIN leave_types t ON t.id = l.leave_type_id
            WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ?";
    $p = [$r['to'], $r['from']];
    if ($ids !== null) {
        $sql .= ' AND l.employee_id IN (' . marks($ids) . ')';
        $p = array_merge($p, $ids);
    }
    respond(['month' => $month, 'items' => array_map(fn($x) => $x + ['name' => full_name($x)], q_all($sql, $p))]);
}
