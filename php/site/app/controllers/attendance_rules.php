<?php
// Attendance rules: selfie at punch-in, QR sign-in, biometric machines, late / early rules, reminders.
// Mirrors server/src/services/attendanceRules.js and server/src/controllers/attendanceAdmin.js.

function att_rules(): array
{
    $s = q_one('SELECT * FROM attendance_settings WHERE id = 1') ?: [];
    unset($s['qr_secret']);
    foreach (['selfie_required', 'late_penalty_on', 'auto_overtime', 'reminders'] as $k) {
        $s[$k] = !empty($s[$k]);
    }
    foreach (['late_halfday_after_min', 'early_halfday_before_min', 'late_free_marks', 'auto_overtime_min', 'remind_checkout_after_min', 'remind_checkin_after_min'] as $k) {
        $s[$k] = (int) ($s[$k] ?? 0);
    }
    return $s;
}

// ---------- settings ----------
function att_settings_get(): void
{
    $r = att_rules();
    if (has_perm('attendance.manage') || has_perm('attendance.view_all')) {
        respond($r);
    }
    respond(['selfie_required' => $r['selfie_required'], 'qr_mode' => $r['qr_mode']]);
}

function att_settings_update(): void
{
    require_admin();
    $b = req_body();
    $bool = fn($k) => in_array($b[$k] ?? null, [true, 1, '1', 'true'], true);
    $int = function (string $k, int $max) use ($b): int {
        if (!isset($b[$k]) || !is_numeric($b[$k]) || (int) $b[$k] != $b[$k] || (int) $b[$k] < 0 || (int) $b[$k] > $max) {
            throw new HttpError(400, 'Validation failed: ' . $k . ' must be a whole number from 0 to ' . $max);
        }
        return (int) $b[$k];
    };
    if (!in_array($b['qr_mode'] ?? null, ['off', 'optional', 'required'], true)) {
        throw new HttpError(400, 'Validation failed: qr_mode');
    }
    $d = [
        'selfie_required' => $bool('selfie_required') ? 1 : 0, 'qr_mode' => $b['qr_mode'],
        'late_halfday_after_min' => $int('late_halfday_after_min', 480), 'early_halfday_before_min' => $int('early_halfday_before_min', 480),
        'late_penalty_on' => $bool('late_penalty_on') ? 1 : 0, 'late_free_marks' => $int('late_free_marks', 31),
        'auto_overtime' => $bool('auto_overtime') ? 1 : 0, 'auto_overtime_min' => $int('auto_overtime_min', 480),
        'reminders' => $bool('reminders') ? 1 : 0, 'remind_checkout_after_min' => $int('remind_checkout_after_min', 480), 'remind_checkin_after_min' => $int('remind_checkin_after_min', 480),
    ];
    $before = att_rules();
    q_update('attendance_settings', $d + ['updated_at' => ts()], 'id = ?', [1]);
    audit('attendance_settings', 1, 'update', $before, $d);
    respond(att_rules());
}

// ---------- QR sign-in ----------
function att_qr_secret(): string
{
    $s = q_val('SELECT qr_secret FROM attendance_settings WHERE id = 1');
    if (!$s) {
        $s = bin2hex(random_bytes(32));
        q_update('attendance_settings', ['qr_secret' => $s], 'id = ?', [1]);
    }
    return $s;
}
function att_qr_sig(string $secret, int $w): string { return substr(hash_hmac('sha256', 'qr:' . $w, $secret), 0, 24); }

function att_qr(): void
{
    if (att_rules()['qr_mode'] === 'off') {
        throw new HttpError(400, 'QR sign-in is switched off. Turn it on in the Master sheet first.');
    }
    $w = intdiv(time(), 30);
    respond(['token' => $w . '.' . att_qr_sig(att_qr_secret(), $w), 'company' => $GLOBALS['COMPANY']['code'] ?? null, 'refresh_in' => 30]);
}

function att_qr_valid($token): bool
{
    if (!is_string($token) || !preg_match('/^(\d{1,12})\.([0-9a-f]{24})$/', $token, $m)) {
        return false;
    }
    $w = (int) $m[1];
    $now = intdiv(time(), 30);
    if ($now - $w > 8 || $w > $now + 1) { // good for about four minutes, enough to scan, open the app and sign in
        return false;
    }
    return hash_equals(att_qr_sig(att_qr_secret(), $w), $m[2]);
}

// Returns the source of the punch: 'qr' or 'web'. Refuses when a code is needed and missing, or is old.
function att_punch_source(array $rules): string
{
    $code = req_body()['qr'] ?? null;
    if ($rules['qr_mode'] === 'required' && !$code) {
        throw new HttpError(403, 'Scan the QR code shown at the office to check in or out.');
    }
    if ($code && $rules['qr_mode'] !== 'off') {
        if (!att_qr_valid($code)) {
            throw new HttpError(400, 'That QR code has expired. Please scan the screen at the office again.');
        }
        return 'qr';
    }
    return 'web';
}

// ---------- selfie ----------
// A small JPEG taken by the browser camera, sent as text. Anything that is not a clean JPEG is refused.
function att_save_selfie($photo, bool $required): ?string
{
    if (!$photo) {
        if ($required) {
            throw new HttpError(400, 'A selfie is needed to check in. Allow camera access in your browser and take a photo.');
        }
        return null;
    }
    if (!is_string($photo) || !preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/]+={0,2})$#', $photo, $m)) {
        throw new HttpError(400, 'The selfie must be a JPEG photo.');
    }
    $buf = base64_decode($m[1], true);
    if ($buf === false || strlen($buf) < 1000 || strlen($buf) > 300000) {
        throw new HttpError(400, 'The selfie is too small or too large.');
    }
    if (substr($buf, 0, 3) !== "\xFF\xD8\xFF" || substr($buf, -2) !== "\xFF\xD9") {
        throw new HttpError(400, 'The selfie is not a valid JPEG photo.');
    }
    $low = strtolower($buf);
    if (strpos($low, '<?php') !== false || strpos($low, '<script') !== false) {
        throw new HttpError(400, 'The selfie is not a valid JPEG photo.');
    }
    $dir = uploads_root() . '/attendance';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $name = bin2hex(random_bytes(16)) . '.jpg';
    if (file_put_contents($dir . '/' . $name, $buf) === false) {
        throw new HttpError(500, 'Could not save the photo.');
    }
    return 'attendance/' . $name;
}

function att_photo(array $p): void
{
    $rec = q_one('SELECT * FROM attendance WHERE id = ?', [(int) $p['id']]);
    if (!$rec) {
        throw new HttpError(404, 'Not found');
    }
    if ((int) $rec['employee_id'] !== user()['employeeId']) {
        assert_access((int) $rec['employee_id'], 'attendance.view_all');
    }
    $rel = $rec[($p['kind'] === 'out' ? 'out' : 'in') . '_photo'] ?? null;
    if (!$rel) {
        throw new HttpError(404, 'No photo');
    }
    send_stored_file($rel, 'selfie.jpg', 'image/jpeg', true);
}

// ---------- biometric / machine keys ----------
function att_devices(): void
{
    require_admin();
    respond(array_map(fn($d) => ['id' => (int) $d['id'], 'name' => $d['name'], 'active' => (bool) $d['active'], 'last_seen' => $d['last_seen']], q_all('SELECT * FROM attendance_devices ORDER BY id')));
}
function att_device_add(): void
{
    require_admin();
    $name = trim((string) (req_body()['name'] ?? ''));
    if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
        throw new HttpError(400, 'Validation failed: name');
    }
    $secret = bin2hex(random_bytes(24));
    $id = q_insert('attendance_devices', ['name' => $name, 'key_hash' => hash('sha256', $secret), 'active' => 1, 'created_at' => ts(), 'updated_at' => ts()]);
    audit('attendance_device', $id, 'create', null, ['name' => $name]);
    respond(['id' => $id, 'name' => $name, 'key' => (int) ($GLOBALS['COMPANY']['id'] ?? 0) . '.' . $secret], 201); // the only time the key is shown
}
function att_device_update(array $p): void
{
    require_admin();
    $b = req_body();
    if (!array_key_exists('active', $b)) {
        throw new HttpError(400, 'Validation failed: active');
    }
    $on = in_array($b['active'], [true, 1, '1', 'true'], true);
    if (!q_one('SELECT id FROM attendance_devices WHERE id = ?', [(int) $p['id']])) {
        throw new HttpError(404, 'Device not found');
    }
    q_update('attendance_devices', ['active' => $on ? 1 : 0, 'updated_at' => ts()], 'id = ?', [(int) $p['id']]);
    audit('attendance_device', (int) $p['id'], $on ? 'enable' : 'disable');
    respond(['ok' => true]);
}
function att_device_delete(array $p): void
{
    require_admin();
    if (!q_one('SELECT id FROM attendance_devices WHERE id = ?', [(int) $p['id']])) {
        throw new HttpError(404, 'Device not found');
    }
    q_run('DELETE FROM attendance_devices WHERE id = ?', [(int) $p['id']]);
    audit('attendance_device', (int) $p['id'], 'delete');
    no_content();
}

function att_punch_time($raw): string
{
    if ($raw === null || $raw === '') {
        return ts();
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/', (string) $raw, $m)) { // no zone given = the company's local time
        return local_to_ts($m[1], $m[2]);
    }
    try {
        return (new DateTimeImmutable((string) $raw))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    } catch (Throwable $e) {
        throw new RuntimeException('Time is not understood');
    }
}

// A machine sends punches: { punches: [{ emp_code, time? }] } with header X-Device-Key.
function att_device_punch(): void
{
    $key = (string) (req_headers()['x-device-key'] ?? '');
    $secret = strpos($key, '.') !== false ? explode('.', $key, 2)[1] : '';
    $dev = $secret !== '' ? q_one('SELECT * FROM attendance_devices WHERE key_hash = ? AND active = 1', [hash('sha256', $secret)]) : null;
    if (!$dev) {
        throw new HttpError(401, 'Unknown or switched-off device key');
    }
    q_update('attendance_devices', ['last_seen' => ts()], 'id = ?', [$dev['id']]);
    $b = req_body();
    $punches = $b['punches'] ?? null;
    if (!is_array($punches) || !$punches || count($punches) > 500) {
        throw new HttpError(400, 'Validation failed: punches (1 to 500)');
    }
    $rules = att_rules();
    $rows = [];
    $skipped = [];
    foreach ($punches as $p) {
        $code = trim((string) ($p['emp_code'] ?? ''));
        if ($code === '' || mb_strlen($code) > 40) {
            throw new HttpError(400, 'Validation failed: emp_code');
        }
        try {
            $rows[] = ['emp_code' => $code, 'at' => att_punch_time($p['time'] ?? null)];
        } catch (RuntimeException $e) {
            $skipped[] = ['emp_code' => $code, 'reason' => $e->getMessage()];
        }
    }
    usort($rows, fn($a, $c) => strcmp($a['at'], $c['at']));
    $newest = gmdate('Y-m-d H:i:s', time() + 300);
    $oldest = gmdate('Y-m-d H:i:s', time() - 62 * 86400);
    $saved = 0;
    foreach ($rows as $p) {
        $emp = q_one('SELECT * FROM employees WHERE LOWER(emp_code) = ?', [strtolower($p['emp_code'])]);
        if (!$emp || $emp['status'] === 'exited') {
            $skipped[] = ['emp_code' => $p['emp_code'], 'reason' => 'No active employee with this code'];
            continue;
        }
        if ($p['at'] > $newest || $p['at'] < $oldest) {
            $skipped[] = ['emp_code' => $p['emp_code'], 'reason' => 'Time is in the future or more than 62 days old'];
            continue;
        }
        $date = local_parts(parse_ts($p['at']))['date'];
        if ($date < substr((string) $emp['join_date'], 0, 10)) {
            $skipped[] = ['emp_code' => $p['emp_code'], 'reason' => 'Before the joining date'];
            continue;
        }
        $shift = shift_for($emp);
        $rec = q_one('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [$emp['id'], $date]);
        if (!$rec || !$rec['check_in']) {
            $calc = evaluate_day($shift, $p['at'], null, $rules);
            if ($rec) {
                q_update('attendance', ['check_in' => $p['at'], 'source' => 'device', 'updated_at' => ts()] + $calc, 'id = ?', [$rec['id']]);
            } else {
                q_insert('attendance', ['employee_id' => $emp['id'], 'date' => $date, 'check_in' => $p['at'], 'source' => 'device', 'created_at' => ts(), 'updated_at' => ts()] + $calc);
            }
            $saved++;
            continue;
        }
        $gap = fn($a, $c) => abs(parse_ts($a) - parse_ts($c));
        if ($gap($p['at'], $rec['check_in']) < 120 || ($rec['check_out'] && $gap($p['at'], $rec['check_out']) < 120)) {
            $skipped[] = ['emp_code' => $p['emp_code'], 'reason' => 'Same punch sent twice'];
            continue;
        }
        $in = $rec['check_in'];
        $out = $rec['check_out'];
        if ($p['at'] < $in) {
            $out = $out ?: $in;
            $in = $p['at'];
        } elseif (!$out || $p['at'] > $out) {
            $out = $p['at'];
        } else {
            $skipped[] = ['emp_code' => $p['emp_code'], 'reason' => 'Between the first and last punch of the day'];
            continue;
        }
        q_update('attendance', ['check_in' => $in, 'check_out' => $out, 'updated_at' => ts()] + evaluate_day($shift, $in, $out, $rules), 'id = ?', [$rec['id']]);
        $saved++;
        ot_auto($emp, $date);
    }
    respond(['saved' => $saved, 'skipped' => $skipped]);
}

// ---------- reminders ----------
function att_send_reminders(): int
{
    $rules = att_rules();
    if (!$rules['reminders']) {
        return 0;
    }
    $now = local_parts();
    if ($now['minutes'] < 300) {
        return 0;
    }
    $sent = 0;
    foreach (q_all("SELECT * FROM employees WHERE status != 'exited' AND join_date <= ?", [$now['date']]) as $e) {
        $shift = shift_for($e);
        $day = day_statuses($e, $now['date'], $now['date'])[0];
        $start = to_minutes($shift['start_time']);
        $end = to_minutes($shift['end_time']);
        $kind = null;
        if (!empty($day['record']['check_in']) && empty($day['record']['check_out']) && $end > $start && $now['minutes'] >= $end + $rules['remind_checkout_after_min']) {
            $kind = 'checkout';
        } elseif ($day['status'] === 'pending' && $rules['remind_checkin_after_min'] > 0 && $now['minutes'] >= $start + $rules['remind_checkin_after_min'] && $now['minutes'] < $end) {
            $kind = 'checkin';
        }
        if (!$kind || q_one('SELECT id FROM attendance_reminders WHERE employee_id = ? AND date = ? AND kind = ?', [$e['id'], $now['date'], $kind])) {
            continue;
        }
        q_insert('attendance_reminders', ['employee_id' => $e['id'], 'date' => $now['date'], 'kind' => $kind]);
        notify_employee((int) $e['id'], $kind === 'checkout'
            ? ['type' => 'attendance_reminder', 'title' => 'Did you forget to check out?', 'body' => 'Your shift has ended and you have not checked out yet. Check out now, or ask for a correction (regularization) if you left earlier.', 'link' => '/attendance']
            : ['type' => 'attendance_reminder', 'title' => 'You have not checked in today', 'body' => 'Your shift has started and there is no check-in for you yet. If you are on leave, ignore this.', 'link' => '/attendance']);
        $sent++;
    }
    return $sent;
}

function att_reminders_now(): void
{
    require_admin();
    respond(['sent' => att_send_reminders()]);
}

// Every few minutes, after the page has been sent, each company gets its reminders. Switch off with 'reminders' => ['auto' => false] in config.php.
function att_reminders_maybe_run(): void
{
    $cfg = (array) cfg('reminders', []);
    if (($cfg['auto'] ?? true) === false) {
        return;
    }
    $mark = rl_dir() . '/reminders.mark';
    if (is_file($mark) && time() - filemtime($mark) < 300) {
        return;
    }
    @touch($mark); // claim this run first, so two visitors cannot start two
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        try {
            foreach (q_all('SELECT * FROM companies') as $c) {
                try {
                    company_assert_usable($c);
                    tenant_with((string) $c['prefix'], fn() => att_send_reminders());
                } catch (Throwable $e) {
                    // a suspended or expired company, or one not yet updated: skip it
                }
            }
        } catch (Throwable $e) {
            error_log('WorkPilot reminders failed: ' . $e->getMessage());
        }
    });
}
