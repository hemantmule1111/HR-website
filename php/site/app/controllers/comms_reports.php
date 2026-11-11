<?php
// Notifications, announcements, dashboard summary, reports and the audit log.

// ---------- notifications ----------
function notif_list(): void
{
    $items = q_all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [user()['id']]);
    $unread = (int) q_val('SELECT COUNT(id) FROM notifications WHERE user_id = ? AND read_at IS NULL', [user()['id']]);
    respond(['unread' => $unread, 'items' => $items]);
}
function notif_mark_read(array $p): void
{
    q_update('notifications', ['read_at' => ts()], 'id = ? AND user_id = ?', [(int) $p['id'], user()['id']]);
    no_content();
}
function notif_mark_all(): void
{
    q_update('notifications', ['read_at' => ts()], 'user_id = ? AND read_at IS NULL', [user()['id']]);
    no_content();
}

// ---------- announcements ----------
function announce_spec(): array
{
    return [
        'title' => [fn($v, $k) => $v->str($k, 1, 150), true],
        'body' => [fn($v, $k) => $v->str($k, 1, 5000), true],
        'pinned' => [fn($v, $k) => $v->bool($k), false],
    ];
}
function announce_list(): void
{
    respond(q_all('SELECT * FROM announcements ORDER BY pinned DESC, id DESC LIMIT 50'));
}
function announce_create(): void
{
    $d = parse_spec(req_body(), announce_spec());
    $row = $d;
    if (isset($row['pinned'])) { $row['pinned'] = $row['pinned'] ? 1 : 0; }
    $id = q_insert('announcements', $row + ['created_by' => user()['id'], 'created_at' => ts(), 'updated_at' => ts()]);
    audit('announcement', $id, 'create', null, $d);
    $users = q_col('SELECT id FROM users WHERE is_active = 1 AND id != ?', [user()['id']]);
    notify_users($users, ['type' => 'announcement', 'title' => $d['title'], 'body' => mb_substr($d['body'], 0, 200), 'link' => '/']);
    respond(q_one('SELECT * FROM announcements WHERE id = ?', [$id]), 201);
}
function announce_update(array $p): void
{
    $d = parse_spec(req_body(), announce_spec(), true);
    $before = q_one('SELECT * FROM announcements WHERE id = ?', [(int) $p['id']]);
    if (!$before) {
        throw new HttpError(404, 'Not found');
    }
    $row = $d;
    if (isset($row['pinned'])) { $row['pinned'] = $row['pinned'] ? 1 : 0; }
    q_update('announcements', $row + ['updated_at' => ts()], 'id = ?', [$before['id']]);
    audit('announcement', $before['id'], 'update', $before, $d);
    respond(q_one('SELECT * FROM announcements WHERE id = ?', [$before['id']]));
}
function announce_delete(array $p): void
{
    $before = q_one('SELECT * FROM announcements WHERE id = ?', [(int) $p['id']]);
    if (!$before) {
        throw new HttpError(404, 'Not found');
    }
    q_exec('DELETE FROM announcements WHERE id = ?', [$before['id']]);
    audit('announcement', $before['id'], 'delete', $before);
    no_content();
}

// ---------- dashboard ----------
function dash_next_occurrence(string $dateStr, string $now): string
{
    [, $m, $d] = explode('-', substr($dateStr, 0, 10));
    $year = (int) substr($now, 0, 4);
    $occ = "$year-$m-$d";
    if ($occ < $now) {
        $occ = ($year + 1) . "-$m-$d";
    }
    return $occ;
}

function dash_summary(): void
{
    $now = today();
    $out = ['today' => $now, 'announcements' => q_all('SELECT * FROM announcements ORDER BY pinned DESC, id DESC LIMIT 4')];
    $emp = user()['employeeId'] ? q_one('SELECT * FROM employees WHERE id = ?', [user()['employeeId']]) : null;

    if ($emp) {
        $day = day_statuses($emp, $now, $now)[0];
        $year = (int) substr($now, 0, 4);
        $balances = [];
        foreach (q_all("SELECT * FROM leave_types WHERE status = 'active' ORDER BY id") as $t) {
            $b = ensure_balance($emp, $t, $year);
            $balances[] = [
                'name' => $t['name'], 'code' => $t['code'], 'color' => $t['color'], 'available' => leave_available($b),
                'total' => (float) $b['opening'] + (float) $b['accrued'], 'used' => (float) $b['used'], 'unlimited' => (float) $t['annual_quota'] == 0.0,
            ];
        }
        $out['me'] = [
            'name' => full_name($emp),
            'day' => ['status' => $day['status'], 'check_in' => $day['record']['check_in'] ?? null, 'check_out' => $day['record']['check_out'] ?? null, 'holiday' => $day['holiday']],
            'balances' => $balances,
            'pending_requests' => (int) q_val("SELECT COUNT(*) FROM leave_requests WHERE employee_id = ? AND status = 'pending'", [$emp['id']]),
        ];
    }

    $out['upcoming_holidays'] = q_all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 5', [$now]);

    $myEmp = $emp ? (int) $emp['id'] : 0;
    $pendingLeave = 0;
    $pendingReg = 0;
    if (has_perm('leave.approve')) {
        $ids = visible_ids('leave.manage');
        $sql = "SELECT COUNT(*) FROM leave_requests WHERE status = 'pending' AND employee_id != ?";
        $p = [$myEmp];
        if ($ids !== null) { $sql .= ' AND employee_id IN (' . marks($ids) . ')'; $p = array_merge($p, $ids); }
        $pendingLeave = (int) q_val($sql, $p);
    }
    if (has_perm('attendance.view_team') || has_perm('attendance.manage')) {
        $rids = visible_ids('attendance.manage');
        $sql = "SELECT COUNT(*) FROM attendance_regularizations WHERE status = 'pending' AND employee_id != ?";
        $p = [$myEmp];
        if ($rids !== null) { $sql .= ' AND employee_id IN (' . marks($rids) . ')'; $p = array_merge($p, $rids); }
        $pendingReg = (int) q_val($sql, $p);
    }
    $pendingOt = 0;
    if (has_perm('attendance.view_team') || has_perm('attendance.manage')) {
        $oids = visible_ids('attendance.manage');
        $sql = "SELECT COUNT(*) FROM overtime_requests WHERE status = 'pending' AND employee_id != ?";
        $p = [$myEmp];
        if ($oids !== null) { $sql .= ' AND employee_id IN (' . marks($oids) . ')'; $p = array_merge($p, $oids); }
        $pendingOt = (int) q_val($sql, $p);
    }
    $out['approvals'] = ['leave' => $pendingLeave, 'regularization' => $pendingReg, 'overtime' => $pendingOt, 'total' => $pendingLeave + $pendingReg + $pendingOt];

    if (has_perm('employee.view_all')) {
        $employees = q_all('SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id');
        $active = array_values(array_filter($employees, fn($e) => $e['status'] !== 'exited'));
        $present = (int) q_val('SELECT COUNT(*) FROM attendance WHERE date = ? AND check_in IS NOT NULL', [$now]);
        $onLeave = (int) q_val("SELECT COUNT(*) FROM leave_requests WHERE status = 'approved' AND from_date <= ? AND to_date >= ?", [$now, $now]);

        $byDept = [];
        foreach ($active as $e) {
            $k = $e['department'] ?: 'Unassigned';
            $byDept[$k] = ($byDept[$k] ?? 0) + 1;
        }
        $depts = [];
        foreach ($byDept as $name => $value) { $depts[] = ['name' => $name, 'value' => $value]; }
        usort($depts, fn($a, $b) => $b['value'] <=> $a['value']);

        $months = [];
        for ($i = 5; $i >= 0; $i--) {
            $months[] = gmdate('Y-m', strtotime(substr($now, 0, 7) . '-01 UTC -' . $i . ' months'));
        }
        $trend = array_map(fn($m) => [
            'month' => $m,
            'joined' => count(array_filter($employees, fn($e) => strpos((string) $e['join_date'], $m) === 0)),
            'exited' => count(array_filter($employees, fn($e) => $e['exit_date'] && strpos((string) $e['exit_date'], $m) === 0)),
        ], $months);

        $from = add_days($now, -13);
        $map = [];
        foreach (q_all('SELECT date, COUNT(*) AS c FROM attendance WHERE date BETWEEN ? AND ? AND check_in IS NOT NULL GROUP BY date', [$from, $now]) as $r) {
            $map[substr((string) $r['date'], 0, 10)] = (int) $r['c'];
        }
        $attTrend = array_map(fn($d) => ['date' => $d, 'present' => $map[$d] ?? 0], each_date($from, $now));

        $horizon = add_days($now, 30);
        $events = [];
        foreach ($active as $e) {
            if ($e['dob']) {
                $date = dash_next_occurrence((string) $e['dob'], $now);
                if ($date <= $horizon) { $events[] = ['type' => 'birthday', 'date' => $date, 'name' => full_name($e), 'department' => $e['department']]; }
            }
            $jd = substr((string) $e['join_date'], 0, 10);
            if ($jd < substr($now, 0, 4) . '-01-01') {
                $date = dash_next_occurrence($jd, $now);
                if ($date <= $horizon) { $events[] = ['type' => 'anniversary', 'date' => $date, 'name' => full_name($e), 'years' => (int) substr($date, 0, 4) - (int) substr($jd, 0, 4)]; }
            }
        }
        usort($events, fn($a, $b) => strcmp($a['date'], $b['date']));

        $leaveByType = q_all(
            'SELECT t.name, t.color, SUM(b.used) AS used FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.year = ? GROUP BY t.name, t.color',
            [(int) substr($now, 0, 4)]
        );
        $monthAgo = add_days($now, -30);
        $out['company'] = [
            'total' => count($active), 'present' => $present, 'on_leave' => $onLeave,
            'probation' => count(array_filter($active, fn($e) => $e['status'] === 'probation')),
            'departments' => $depts, 'trend' => $trend, 'attendance_trend' => $attTrend, 'events' => array_slice($events, 0, 8),
            'leave_by_type' => array_map(fn($r) => ['name' => $r['name'], 'color' => $r['color'], 'used' => (float) ($r['used'] ?? 0)], $leaveByType),
            'new_joiners' => count(array_filter($active, fn($e) => substr((string) $e['join_date'], 0, 10) >= $monthAgo)),
        ];
    }
    respond($out);
}

// ---------- reports ----------
function report_send(string $name, array $columns, array $rows): void
{
    if (($_GET['format'] ?? '') === 'csv') {
        send_csv($name . '.csv', $rows, $columns);
    }
    respond(['name' => $name, 'columns' => $columns, 'rows' => $rows]);
}

function report_headcount(): void
{
    $map = [];
    foreach (q_all('SELECT e.status, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id') as $e) {
        $key = $e['department'] ?: 'Unassigned';
        $row = $map[$key] ?? ['department' => $key, 'probation' => 0, 'active' => 0, 'notice' => 0, 'exited' => 0, 'total' => 0];
        if (isset($row[$e['status']])) { $row[$e['status']]++; }
        if ($e['status'] !== 'exited') { $row['total']++; }
        $map[$key] = $row;
    }
    $rows = array_values($map);
    usort($rows, fn($a, $b) => $b['total'] <=> $a['total']);
    $columns = array_map(fn($k) => ['key' => $k, 'label' => ucfirst($k)], ['department', 'probation', 'active', 'notice', 'exited', 'total']);
    report_send('headcount', $columns, $rows);
}

function report_attendance(): void
{
    $month = $_GET['month'] ?? current_month();
    if (!is_month_str($month)) {
        throw new HttpError(400, 'Invalid month');
    }
    $r = month_range($month);
    $rows = [];
    foreach (q_all("SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited' ORDER BY e.first_name") as $e) {
        $days = day_statuses($e, $r['from'], $r['to']);
        $c = fn($s) => count(array_filter($days, fn($d) => $d['status'] === $s));
        $minutes = array_sum(array_map(fn($d) => (int) ($d['record']['worked_minutes'] ?? 0), $days));
        $rows[] = [
            'emp_code' => $e['emp_code'], 'name' => full_name($e), 'department' => $e['department'] ?: '',
            'present' => $c('present'), 'half_day' => $c('half_day'), 'absent' => $c('absent'),
            'leave' => $c('leave') + $c('half_leave') * 0.5, 'late' => count(array_filter($days, fn($d) => (int) ($d['record']['late_minutes'] ?? 0) > 0)),
            'hours' => round($minutes / 6) / 10,
        ];
    }
    $cols = [['emp_code', 'Code'], ['name', 'Employee'], ['department', 'Department'], ['present', 'Present'], ['half_day', 'Half days'], ['absent', 'Absent'], ['leave', 'Leave'], ['late', 'Late arrivals'], ['hours', 'Hours worked']];
    report_send('attendance-' . $month, array_map(fn($c) => ['key' => $c[0], 'label' => $c[1]], $cols), $rows);
}

function report_leave(): void
{
    $year = (int) ($_GET['year'] ?? 0) ?: (int) substr(today(), 0, 4);
    $types = q_all('SELECT * FROM leave_types ORDER BY id');
    $bal = q_all('SELECT * FROM leave_balances WHERE year = ?', [$year]);
    $rows = [];
    foreach (q_all("SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'exited' ORDER BY e.first_name") as $e) {
        $row = ['emp_code' => $e['emp_code'], 'name' => full_name($e), 'department' => $e['department'] ?: ''];
        $total = 0;
        foreach ($types as $t) {
            $used = 0;
            foreach ($bal as $b) {
                if ((int) $b['employee_id'] === (int) $e['id'] && (int) $b['leave_type_id'] === (int) $t['id']) { $used = (float) $b['used']; break; }
            }
            $row['t' . $t['id']] = $used;
            $total += $used;
        }
        $row['total'] = $total;
        $rows[] = $row;
    }
    $cols = array_merge(
        [['key' => 'emp_code', 'label' => 'Code'], ['key' => 'name', 'label' => 'Employee'], ['key' => 'department', 'label' => 'Department']],
        array_map(fn($t) => ['key' => 't' . $t['id'], 'label' => $t['name'] . ' used'], $types),
        [['key' => 'total', 'label' => 'Total used']]
    );
    report_send('leave-' . $year, $cols, $rows);
}

// ---------- audit log ----------
function audit_list(): void
{
    $limit = min((int) ($_GET['limit'] ?? 50) ?: 50, 200);
    $offset = (int) ($_GET['offset'] ?? 0);
    $rows = q_all('SELECT a.*, u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?', [$limit, $offset]);
    respond(array_map(function ($r) {
        $r['old_value'] = json_or_null($r['old_value']);
        $r['new_value'] = json_or_null($r['new_value']);
        return $r;
    }, $rows));
}
