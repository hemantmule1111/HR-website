<?php
// Dates, sign-in tokens, permissions, team scoping, audit trail, notifications, attendance and leave rules.

// ---------- dates (stored times are UTC 'YYYY-MM-DD HH:MM:SS'; calendar dates are company-local 'YYYY-MM-DD') ----------
function company_tz(): DateTimeZone { return new DateTimeZone(cfg('company_tz', 'Asia/Kolkata')); }
function ts(?int $unix = null): string { return gmdate('Y-m-d H:i:s', $unix ?? time()); }
function parse_ts(?string $s): ?int
{
    if (!$s) {
        return null;
    }
    $t = strtotime(substr(str_replace('T', ' ', $s), 0, 19) . ' UTC');
    return $t === false ? null : $t;
}
function local_parts(?int $unix = null): array
{
    $d = (new DateTimeImmutable('@' . ($unix ?? time())))->setTimezone(company_tz());
    return ['date' => $d->format('Y-m-d'), 'time' => $d->format('H:i'), 'minutes' => (int) $d->format('G') * 60 + (int) $d->format('i')];
}
function today(): string { return local_parts()['date']; }
function to_minutes(string $hhmm): int { [$h, $m] = array_map('intval', explode(':', $hhmm)); return $h * 60 + $m; }
function add_days(string $d, int $n): string { return gmdate('Y-m-d', strtotime($d . ' UTC') + $n * 86400); }
function day_of_week(string $d): int { return (int) gmdate('w', strtotime($d . ' UTC')); }
function each_date(string $from, string $to): array
{
    $out = [];
    for ($d = $from; $d <= $to; $d = add_days($d, 1)) {
        $out[] = $d;
    }
    return $out;
}
function month_range(string $ym): array
{
    [$y, $m] = array_map('intval', explode('-', $ym));
    $last = (int) gmdate('t', gmmktime(0, 0, 0, $m, 1, $y));
    return ['from' => $ym . '-01', 'to' => $ym . '-' . str_pad((string) $last, 2, '0', STR_PAD_LEFT), 'days' => $last];
}
function current_month(): string { return substr(today(), 0, 7); }
function is_date_str($s): bool { return is_string($s) && (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s); }
function is_month_str($s): bool { return is_string($s) && (bool) preg_match('/^\d{4}-\d{2}$/', $s); }
function local_to_ts(string $date, string $hhmm): string
{
    $d = new DateTimeImmutable($date . ' ' . $hhmm . ':00', company_tz());
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

// ---------- sign-in tokens (HS256 JWT) and passwords ----------
function jwt_secret(): string
{
    $s = (string) cfg('jwt_secret', '');
    if (strlen($s) < 20 || strpos($s, 'PUT_') === 0) {
        throw new HttpError(500, 'Set jwt_secret in app/config.php to a long random string.');
    }
    return $s;
}
function jwt_sign(array $payload, int $ttl): string
{
    $now = time();
    $head = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $body = b64url(json_encode($payload + ['iat' => $now, 'exp' => $now + $ttl]));
    return $head . '.' . $body . '.' . b64url(hash_hmac('sha256', "$head.$body", jwt_secret(), true));
}
function jwt_verify(string $token): ?array
{
    $p = explode('.', $token);
    if (count($p) !== 3) {
        return null;
    }
    $good = b64url(hash_hmac('sha256', "$p[0].$p[1]", jwt_secret(), true));
    if (!hash_equals($good, $p[2])) {
        return null;
    }
    $data = json_decode(b64url_dec($p[1]), true);
    if (!is_array($data) || ($data['exp'] ?? 0) < time()) {
        return null;
    }
    return $data;
}
function password_ok(string $plain, string $hash): bool
{
    if (strpos($hash, '$2b$') === 0) { // hashes made by the Node version use the $2b$ prefix; it is the same algorithm as $2y$
        $hash = '$2y$' . substr($hash, 4);
    }
    return password_verify($plain, $hash);
}
function password_make(string $plain): string { return password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]); }
function refresh_stamp(array $user): string { return substr(hash('sha256', $user['password_hash']), 0, 16); }

// ---------- the signed-in user ----------
$GLOBALS['USER'] = null;
function authenticate(): array
{
    $h = req_headers();
    $raw = $h['authorization'] ?? ($h['x-auth-token'] ?? '');
    $token = stripos($raw, 'Bearer ') === 0 ? substr($raw, 7) : $raw;
    if ($token === '') {
        throw new HttpError(401, 'Authentication required');
    }
    $p = jwt_verify($token);
    if (!$p) {
        throw new HttpError(401, 'Invalid or expired token');
    }
    if (!company() || (int) ($p['cid'] ?? 0) !== (int) company()['id'] || !empty($p['rp']) || !empty($p['tf'])) { // a password-reset link or a half-finished sign-in is never a session
        throw new HttpError(401, 'Invalid or expired token');
    }
    $u = q_one('SELECT * FROM users WHERE id = ? AND is_active = 1', [(int) $p['sub']]);
    if (!$u) {
        throw new HttpError(401, 'Account disabled');
    }
    $keys = q_col('SELECT p.`key` FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?', [(int) $u['role_id']]);
    $GLOBALS['USER'] = [
        'id' => (int) $u['id'], 'email' => $u['email'], 'employeeId' => $u['employee_id'] === null ? null : (int) $u['employee_id'],
        'roleId' => (int) $u['role_id'], 'permissions' => $keys, 'mustChange' => !empty($u['must_change_password']),
        'twoFactorOn' => !empty($u['totp_enabled']),
        'needsTwoFactor' => !array_diff(['user.manage', 'payroll.manage', 'org.manage'], $keys), // Super Admins must use two-step sign-in
        'mustSetup2fa' => !array_diff(['user.manage', 'payroll.manage', 'org.manage'], $keys) && empty($u['totp_enabled']),
    ];
    return $GLOBALS['USER'];
}
function user(): array { return $GLOBALS['USER']; }
function has_perm(string $key): bool { return in_array($key, user()['permissions'], true); }
function require_perm(string ...$keys): void
{
    foreach ($keys as $k) {
        if (has_perm($k)) {
            return;
        }
    }
    throw new HttpError(403, 'Not permitted');
}

// ---------- team scope ----------
function team_ids(int $empId): array
{
    $children = [];
    foreach (q_all('SELECT id, manager_id FROM employees') as $e) {
        if ($e['manager_id']) {
            $children[(int) $e['manager_id']][] = (int) $e['id'];
        }
    }
    $out = [];
    $queue = $children[$empId] ?? [];
    while ($queue) {
        $cur = array_shift($queue);
        $out[] = $cur;
        foreach ($children[$cur] ?? [] as $c) {
            $queue[] = $c;
        }
    }
    return $out;
}
// null = unrestricted; otherwise the employee ids this user may see (self + reporting tree).
function visible_ids(?string $globalPerm): ?array
{
    if ($globalPerm && has_perm($globalPerm)) {
        return null;
    }
    $eid = user()['employeeId'];
    return $eid ? array_merge([$eid], team_ids($eid)) : [];
}
function assert_access(int $employeeId, ?string $globalPerm): void
{
    $ids = visible_ids($globalPerm);
    if ($ids !== null && !in_array($employeeId, $ids, true)) {
        throw new HttpError(403, 'Not permitted');
    }
}
function require_employee(): int
{
    $e = user()['employeeId'];
    if (!$e) {
        throw new HttpError(400, 'Your account is not linked to an employee record');
    }
    return $e;
}
function full_name(array $e): string { return trim(($e['first_name'] ?? '') . ' ' . ($e['last_name'] ?? '')); }
function get_employee(int $id): array
{
    $e = q_one('SELECT * FROM employees WHERE id = ?', [$id]);
    if (!$e) {
        throw new HttpError(404, 'Employee not found');
    }
    return $e;
}

// ---------- audit and notifications ----------
function audit(string $entity, $entityId, string $action, $old = null, $new = null): void
{
    q_insert('audit_logs', [
        'user_id' => $GLOBALS['USER']['id'] ?? null, 'entity' => $entity, 'entity_id' => $entityId === null ? null : (string) $entityId,
        'action' => $action, 'old_value' => $old ? json_encode($old, JSON_UNESCAPED_UNICODE) : null,
        'new_value' => $new ? json_encode($new, JSON_UNESCAPED_UNICODE) : null, 'ip' => client_ip(), 'created_at' => ts(),
    ]);
}
function notify_users(array $userIds, array $p): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $userIds))));
    foreach ($ids as $uid) {
        q_insert('notifications', ['user_id' => $uid, 'type' => $p['type'], 'title' => $p['title'], 'body' => $p['body'] ?? null, 'link' => $p['link'] ?? null, 'created_at' => ts()]);
    }
    // Things people must act on or know about are also emailed (not birthdays, anniversaries or announcements, which would be noise).
    if ($ids && in_array($p['type'], ['leave', 'regularization', 'overtime', 'payroll', 'employment', 'helpdesk', 'attendance_reminder'], true)) {
        foreach (q_all('SELECT email FROM users WHERE is_active = 1 AND id IN (' . marks($ids) . ')', $ids) as $u) {
            mail_notification($u['email'], $p);
        }
    }
}
function notify_employee(int $employeeId, array $p): void
{
    notify_users(q_col('SELECT id FROM users WHERE employee_id = ? AND is_active = 1', [$employeeId]), $p);
}
// The employee's manager; if there is none, everyone holding the fallback permission (HR).
function notify_approvers(array $employee, array $p, string $fallbackPerm = 'leave.manage'): void
{
    if (!empty($employee['manager_id'])) {
        notify_employee((int) $employee['manager_id'], $p);
        return;
    }
    notify_users(q_col(
        'SELECT u.id FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.`key` = ? AND u.is_active = 1',
        [$fallbackPerm]
    ), $p);
}

// ---------- attendance rules ----------
const DEFAULT_SHIFT = ['start_time' => '09:30', 'end_time' => '18:30', 'grace_minutes' => 15, 'half_day_minutes' => 240, 'weekly_offs' => '0'];

function shift_for(array $employee): array
{
    $s = !empty($employee['shift_id']) ? q_one('SELECT * FROM shifts WHERE id = ?', [(int) $employee['shift_id']]) : null;
    return $s ?: DEFAULT_SHIFT;
}
function weekoff_set(array $shift): array
{
    return array_map('intval', array_filter(explode(',', (string) ($shift['weekly_offs'] ?? '')), fn($x) => $x !== ''));
}
// $rules (attendance_settings) can turn a very late arrival or an early leaving into a half day.
function evaluate_day(array $shift, string $checkIn, ?string $checkOut, array $rules = []): array
{
    $inMin = local_parts(parse_ts($checkIn))['minutes'];
    $start = to_minutes($shift['start_time']);
    $late = $inMin > $start + (int) $shift['grace_minutes'] ? $inMin - $start : 0;
    $worked = 0;
    $early = 0;
    $status = 'present';
    if ($checkOut) {
        $worked = max(0, (int) round((parse_ts($checkOut) - parse_ts($checkIn)) / 60));
        if ($worked < (int) $shift['half_day_minutes']) {
            $status = 'half_day';
        }
        $end = to_minutes($shift['end_time']);
        $outMin = local_parts(parse_ts($checkOut))['minutes'];
        if ($end > $start && $outMin < $end) {
            $early = $end - $outMin;
        }
    }
    if (($rules['late_halfday_after_min'] ?? 0) > 0 && $late >= $rules['late_halfday_after_min']) {
        $status = 'half_day';
    }
    if ($checkOut && ($rules['early_halfday_before_min'] ?? 0) > 0 && $early >= $rules['early_halfday_before_min']) {
        $status = 'half_day';
    }
    return ['late_minutes' => $late, 'worked_minutes' => $worked, 'status' => $status, 'early_minutes' => $early];
}
function holiday_map(string $from, string $to): array
{
    $out = [];
    foreach (q_all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', [$from, $to]) as $h) {
        $out[substr((string) $h['date'], 0, 10)] = $h;
    }
    return $out;
}

// Day-by-day status for one employee; `paid` is the fraction of the day that counts as paid.
function day_statuses(array $employee, string $from, string $to): array
{
    $shift = shift_for($employee);
    $rules = att_rules();
    $offs = weekoff_set($shift);
    $records = [];
    foreach (q_all('SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?', [(int) $employee['id'], $from, $to]) as $r) {
        $records[substr((string) $r['date'], 0, 10)] = $r;
    }
    $leaves = q_all(
        'SELECT lr.*, lt.name AS type_name, lt.code, lt.is_paid, lt.color FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE lr.employee_id = ? AND lr.status = ? AND lr.from_date <= ? AND lr.to_date >= ?',
        [(int) $employee['id'], 'approved', $to, $from]
    );
    $holidays = holiday_map($from, $to);
    $now = today();
    $join = substr((string) $employee['join_date'], 0, 10);
    $exit = !empty($employee['exit_date']) ? substr((string) $employee['exit_date'], 0, 10) : null;
    $out = [];
    foreach (each_date($from, $to) as $date) {
        $record = $records[$date] ?? null;
        $leave = null;
        foreach ($leaves as $l) {
            if (substr((string) $l['from_date'], 0, 10) <= $date && substr((string) $l['to_date'], 0, 10) >= $date) {
                $leave = $l;
                break;
            }
        }
        $holiday = $holidays[$date] ?? null;
        $base = ['date' => $date, 'record' => $record, 'leave' => $leave, 'holiday' => $holiday ? $holiday['name'] : null];
        if ($date < $join || ($exit && $date > $exit)) {
            $out[] = $base + ['status' => 'na', 'paid' => 0];
            continue;
        }
        if ($leave && !$holiday && !in_array(day_of_week($date), $offs, true)) {
            $half = $leave['day_part'] !== 'full';
            $leavePaid = !empty($leave['is_paid']) ? 1 : 0;
            if (!$half) {
                $out[] = $base + ['status' => 'leave', 'paid' => $leavePaid];
            } else {
                $worked = ($record && $record['status'] !== 'absent') ? 0.5 : 0;
                $out[] = $base + ['status' => 'half_leave', 'paid' => $leavePaid * 0.5 + $worked];
            }
            continue;
        }
        if ($holiday && empty($holiday['is_optional'])) {
            $out[] = $base + ['status' => 'holiday', 'paid' => 1];
            continue;
        }
        if (in_array(day_of_week($date), $offs, true)) {
            $out[] = $base + ['status' => 'weekoff', 'paid' => 1];
            continue;
        }
        if ($record && $record['check_in']) {
            $out[] = $base + ['status' => $record['status'], 'paid' => $record['status'] === 'half_day' ? 0.5 : 1];
            continue;
        }
        if ($date > $now) {
            $out[] = $base + ['status' => 'upcoming', 'paid' => 0];
        } elseif ($date === $now) {
            $out[] = $base + ['status' => 'pending', 'paid' => 0];
        } else {
            $out[] = $base + ['status' => 'absent', 'paid' => 0];
        }
    }
    // After the free late marks of the month, each further late arrival costs half a day's pay.
    if ($rules['late_penalty_on']) {
        $n = 0;
        foreach ($out as $i => $d) {
            if (!empty($d['record']['late_minutes']) && $d['record']['late_minutes'] > 0 && in_array($d['status'], ['present', 'half_day'], true)) {
                $n++;
                if ($n > $rules['late_free_marks'] && $d['status'] === 'present') {
                    $out[$i]['paid'] = 0.5;
                    $out[$i]['late_penalty'] = true;
                }
            }
        }
    }
    return $out;
}

// ---------- leave rules ----------
function count_leave_days(array $employee, array $type, string $from, string $to, string $dayPart): float
{
    if ($to < $from) {
        throw new HttpError(400, 'End date is before start date');
    }
    if ($dayPart !== 'full') {
        if (empty($type['allow_half_day'])) {
            throw new HttpError(400, $type['name'] . ' does not allow half days');
        }
        if ($from !== $to) {
            throw new HttpError(400, 'Half day applies to a single date');
        }
    }
    $offs = weekoff_set(shift_for($employee));
    $holidays = holiday_map($from, $to);
    $days = 0;
    foreach (each_date($from, $to) as $d) {
        $h = $holidays[$d] ?? null;
        $nonWorking = in_array(day_of_week($d), $offs, true) || ($h && empty($h['is_optional']));
        if (!$nonWorking || !empty($type['count_weekoffs'])) {
            $days++;
        }
    }
    if ($days === 0) {
        throw new HttpError(400, 'Selected dates contain no working days');
    }
    return $dayPart === 'full' ? (float) $days : 0.5;
}
function leave_available(array $b): float { return (float) $b['opening'] + (float) $b['accrued'] - (float) $b['used']; }

// Balance row for a year; created on demand with pro-rata quota for new joiners and capped carry-forward.
function ensure_balance(array $employee, array $type, int $year): array
{
    $found = q_one('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [(int) $employee['id'], (int) $type['id'], $year]);
    if ($found) {
        return $found;
    }
    $accrued = (float) $type['annual_quota'];
    $joinYear = (int) substr((string) $employee['join_date'], 0, 4);
    if ($joinYear === $year) {
        $joinMonth = (int) substr((string) $employee['join_date'], 5, 2);
        $accrued = round(($accrued * (13 - $joinMonth)) / 12 * 2) / 2;
    }
    $opening = 0.0;
    $prev = q_one('SELECT * FROM leave_balances WHERE employee_id = ? AND leave_type_id = ? AND year = ?', [(int) $employee['id'], (int) $type['id'], $year - 1]);
    if ($prev) {
        $opening = max(0.0, min(leave_available($prev), (float) $type['carry_forward_max']));
    }
    $row = ['employee_id' => (int) $employee['id'], 'leave_type_id' => (int) $type['id'], 'year' => $year, 'opening' => $opening, 'accrued' => $accrued, 'used' => 0, 'created_at' => ts(), 'updated_at' => ts()];
    $id = q_insert('leave_balances', $row);
    return ['id' => $id] + $row;
}
