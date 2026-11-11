<?php
// Sign-in, users and the master lists (departments, designations, shifts, leave types, holidays).

// ---------- tiny schema helper: key => [validator(V, key), required, default] ----------
function parse_spec(array $in, array $spec, bool $partial = false): array
{
    $v = new V($in);
    $out = [];
    foreach ($spec as $k => $def) {
        $fn = $def[0];
        $required = $def[1] ?? false;
        $default = $def[2] ?? null;
        if (!$v->has($k) || ($in[$k] === null && !$required)) {
            if ($v->has($k) && $in[$k] === null) {
                $out[$k] = null; // an explicit null clears an optional column
            } elseif (!$partial && $default !== null) {
                $out[$k] = $default;
            } elseif (!$partial && $required) {
                $v->errors[] = ['code' => 'invalid', 'path' => [$k], 'message' => 'Required'];
            }
            continue;
        }
        $out[$k] = $fn($v, $k);
    }
    $v->done();
    return $out;
}

// ---------- auth ----------
const MAX_FAILS = 5;
const LOCK_MIN = 15;

function refresh_cookie_path(): string { return ($GLOBALS['API_BASE'] ?? '') . '/api/v1/auth'; }
function set_refresh_cookie(string $token): void
{
    setcookie('refresh', $token, ['expires' => time() + 7 * 86400, 'path' => refresh_cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict']);
}
function clear_refresh_cookie(): void
{
    setcookie('refresh', '', ['expires' => time() - 3600, 'path' => refresh_cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict']);
}
// cid = the company the user belongs to; every later request is answered from that company's data only.
function access_token(array $u): string { return jwt_sign(['sub' => (int) $u['id'], 'cid' => (int) company()['id']], 15 * 60); }
function refresh_token(array $u): string { return jwt_sign(['sub' => (int) $u['id'], 'v' => refresh_stamp($u), 'cid' => (int) company()['id']], 7 * 86400); }

function auth_login(): void
{
    rl_limit('login:' . client_ip(), 20, 900, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $email = $v->email('email');
    $password = $v->str('password', 1, 1000);
    $v->done();
    if (!company()) {
        throw new HttpError(400, 'Enter your company code');
    }
    $u = q_one('SELECT * FROM users WHERE email = ?', [$email]);
    if ($u && $u['locked_until'] && parse_ts($u['locked_until']) > time()) {
        throw new HttpError(423, 'Account temporarily locked. Try again later.');
    }
    $ok = $u && $u['is_active'] && password_ok($password, $u['password_hash']);
    if (!$ok) {
        if ($u) {
            $fails = (int) $u['failed_logins'] + 1;
            q_update('users', $fails >= MAX_FAILS
                ? ['failed_logins' => 0, 'locked_until' => ts(time() + LOCK_MIN * 60)]
                : ['failed_logins' => $fails], 'id = ?', [$u['id']]);
        }
        throw new HttpError(401, 'Invalid email or password');
    }
    if ($u['totp_enabled']) { // password was right: the second step comes next. No session is issued yet.
        respond(['twoFactor' => true, 'challenge' => jwt_sign(['sub' => (int) $u['id'], 'cid' => (int) company()['id'], 'tf' => 1], 300)]);
    }
    auth_issue_session($u);
}

// Signs the person in: refresh cookie + access token. Used after the password (and, when on, the two-step code).
function auth_issue_session(array $u): void
{
    q_update('users', ['failed_logins' => 0, 'locked_until' => null, 'last_login_at' => ts()], 'id = ?', [$u['id']]);
    try { q_update('companies', ['last_login_at' => ts()], 'id = ?', [company()['id']]); } catch (Throwable $e) { /* platform tables not updated yet */ }
    set_refresh_cookie(refresh_token($u));
    $GLOBALS['USER'] = ['id' => (int) $u['id']];
    audit('user', $u['id'], 'login');
    respond(['accessToken' => access_token($u)]);
}

function auth_refresh(): void
{
    $token = $_COOKIE['refresh'] ?? '';
    if ($token === '') {
        throw new HttpError(401, 'No session');
    }
    $p = jwt_verify($token);
    if (!$p) {
        throw new HttpError(401, 'Session expired');
    }
    if (!company() || (int) ($p['cid'] ?? 0) !== (int) company()['id'] || !empty($p['rp']) || !empty($p['tf'])) {
        throw new HttpError(401, 'Session expired');
    }
    $u = q_one('SELECT * FROM users WHERE id = ? AND is_active = 1', [(int) $p['sub']]);
    if (!$u || refresh_stamp($u) !== ($p['v'] ?? '')) {
        throw new HttpError(401, 'Session expired');
    }
    respond(['accessToken' => access_token($u)]);
}

// Forgot password: emails a link that works for 1 hour. The answer is always the same, so nobody can find out which emails have accounts.
function auth_forgot_password(): void
{
    $v = new V(req_body());
    $email = strtolower($v->email('email'));
    $v->done();
    if (!company()) {
        throw new HttpError(400, 'Enter your company code');
    }
    rl_limit('forgot:' . client_ip(), 10, 3600, 'Too many requests. Please try again in an hour.');
    $mine = 'forgotmail:' . company()['id'] . ':' . $email;
    $u = rl_count($mine) < 3 ? q_one('SELECT * FROM users WHERE email = ? AND is_active = 1', [$email]) : null;
    if ($u) {
        rl_hit($mine, 3600); // at most 3 emails an hour to one address
        // The link carries a stamp of the current password, so it stops working the moment the password changes (one use only).
        $token = jwt_sign(['sub' => (int) $u['id'], 'v' => refresh_stamp($u), 'cid' => (int) company()['id'], 'rp' => 1], 3600);
        mail_reset_link($u['email'], $token);
        audit('user', $u['id'], 'forgot_password');
    }
    respond(['ok' => true, 'message' => 'If an account with that email exists, we have sent a link to reset the password. It works for 1 hour.']);
}

function auth_reset_password(): void
{
    $v = new V(req_body());
    $token = $v->str('token', 10, 2000);
    $new = $v->str('password', 10, 128);
    $v->done();
    rl_limit('reset:' . client_ip(), 20, 3600, 'Too many attempts. Please try again later.');
    $p = jwt_verify($token);
    if (!$p || empty($p['rp']) || !company() || (int) ($p['cid'] ?? 0) !== (int) company()['id']) {
        throw new HttpError(400, 'This reset link is not valid or has expired. Please ask for a new one.');
    }
    $u = q_one('SELECT * FROM users WHERE id = ? AND is_active = 1', [(int) $p['sub']]);
    if (!$u || refresh_stamp($u) !== ($p['v'] ?? '')) {
        throw new HttpError(400, 'This reset link has already been used or has expired. Please ask for a new one.');
    }
    password_require_strong($new, $u['email']);
    q_update('users', ['password_hash' => password_make($new), 'failed_logins' => 0, 'locked_until' => null, 'must_change_password' => 0], 'id = ?', [$u['id']]);
    $GLOBALS['USER'] = ['id' => (int) $u['id']];
    audit('user', $u['id'], 'reset_password_by_link');
    mail_password_changed($u['email']);
    clear_refresh_cookie();
    no_content();
}

function auth_logout(): void
{
    clear_refresh_cookie();
    no_content();
}

// On a company's own web address the sign-in page needs no company code: this tells it which company the address belongs to.
function auth_host_company(): void
{
    $c = company();
    $host = strtolower(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]);
    respond($c && !empty($c['domain']) && $c['domain'] === $host ? ['code' => $c['code'], 'name' => $c['name']] : new stdClass());
}

function auth_me(): void
{
    $role = q_one('SELECT name FROM roles WHERE id = ?', [user()['roleId']]);
    $emp = user()['employeeId'] ? q_one('SELECT * FROM employees WHERE id = ?', [user()['employeeId']]) : null;
    respond([
        'id' => user()['id'], 'name' => $emp ? full_name($emp) : null, 'email' => user()['email'],
        'employeeId' => user()['employeeId'], 'role' => $role['name'], 'permissions' => user()['permissions'], 'mustChangePassword' => (bool) user()['mustChange'],
        'twoFactor' => ['enabled' => (bool) user()['twoFactorOn'], 'required' => (bool) user()['needsTwoFactor']], 'mustSetupTwoFactor' => (bool) user()['mustSetup2fa'],
        'company' => ['id' => (int) company()['id'], 'code' => company()['code'], 'name' => company()['name']],
        'features' => features_of(company()),
    ]);
}

function auth_change_password(): void
{
    $v = new V(req_body());
    $cur = $v->str('currentPassword', 0, 1000);
    $new = $v->str('newPassword', 10, 128);
    $v->done();
    $u = q_one('SELECT * FROM users WHERE id = ?', [user()['id']]);
    if (!password_ok($cur, $u['password_hash'])) {
        throw new HttpError(400, 'Current password is incorrect');
    }
    password_require_strong($new, $u['email']);
    if ($new === $cur) {
        throw new HttpError(400, 'Choose a different password from the current one');
    }
    q_update('users', ['password_hash' => password_make($new), 'must_change_password' => 0], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'change_password');
    mail_password_changed($u['email']);
    clear_refresh_cookie();
    no_content();
}

// ---------- users ----------
function users_base(string $where = '', array $p = []): array
{
    return q_all(
        'SELECT u.id, u.email, u.is_active, u.last_login_at, u.role_id, r.name AS role, u.employee_id, e.first_name, e.last_name, e.emp_code
         FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN employees e ON e.id = u.employee_id ' . $where . ' ORDER BY u.id',
        $p
    );
}
function users_list(): void { respond(users_base()); }
function users_roles(): void { respond(q_all('SELECT id, name FROM roles ORDER BY id')); }

function users_create(): void
{
    $v = new V(req_body());
    $email = $v->email('email');
    $roleId = $v->int('role_id');
    $empId = $v->optInt('employee_id');
    $v->done();
    $temp = random_token(6);
    $id = q_insert('users', ['email' => $email, 'role_id' => $roleId, 'employee_id' => $empId, 'password_hash' => password_make($temp), 'must_change_password' => 1, 'created_at' => ts(), 'updated_at' => ts()]);
    audit('user', $id, 'create', null, ['email' => $email, 'role_id' => $roleId]);
    mail_welcome($email, '', $temp);
    respond(users_base('WHERE u.id = ?', [$id])[0] + ['temp_password' => $temp], 201);
}

function users_update(array $p): void
{
    $v = new V(req_body());
    $d = [];
    if ($v->has('role_id')) { $d['role_id'] = $v->int('role_id'); }
    if ($v->has('is_active')) { $d['is_active'] = $v->bool('is_active'); }
    $v->done();
    $u = q_one('SELECT * FROM users WHERE id = ?', [(int) $p['id']]);
    if (!$u) {
        throw new HttpError(404, 'User not found');
    }
    if ((int) $u['id'] === user()['id'] && (($d['is_active'] ?? true) === false || (isset($d['role_id']) && $d['role_id'] !== (int) $u['role_id']))) {
        throw new HttpError(400, 'You cannot change your own role or deactivate yourself');
    }
    $set = $d;
    if (isset($set['is_active'])) { $set['is_active'] = $set['is_active'] ? 1 : 0; }
    $set['updated_at'] = ts();
    q_update('users', $set, 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'update', ['role_id' => $u['role_id'], 'is_active' => $u['is_active']], $d);
    respond(users_base('WHERE u.id = ?', [$u['id']])[0]);
}

function users_reset_password(array $p): void
{
    $u = q_one('SELECT * FROM users WHERE id = ?', [(int) $p['id']]);
    if (!$u) {
        throw new HttpError(404, 'User not found');
    }
    $temp = random_token(6);
    q_update('users', ['password_hash' => password_make($temp), 'failed_logins' => 0, 'locked_until' => null, 'must_change_password' => 1], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'reset_password');
    mail_welcome($u['email'], '', $temp, true);
    respond(['temp_password' => $temp]);
}

// ---------- master lists (generic create / read / update / delete) ----------
function org_spec(string $table): array
{
    $status = [fn($v, $k) => $v->optEnum($k, ['active', 'inactive']), false];
    switch ($table) {
        case 'departments':
            return ['name' => [fn($v, $k) => $v->str($k, 1, 100), true], 'head_employee_id' => [fn($v, $k) => $v->optInt($k), false], 'status' => $status];
        case 'designations':
            return ['title' => [fn($v, $k) => $v->str($k, 1, 100), true], 'level' => [function ($v, $k) {
                $n = $v->int($k);
                if ($n < 1 || $n > 20) { $v->errors[] = ['code' => 'invalid', 'path' => [$k], 'message' => 'Must be between 1 and 20']; }
                return $n;
            }, false], 'status' => $status];
        case 'shifts':
            return [
                'name' => [fn($v, $k) => $v->str($k, 1, 80), true],
                'start_time' => [fn($v, $k) => $v->time($k), true],
                'end_time' => [fn($v, $k) => $v->time($k), true],
                'grace_minutes' => [function ($v, $k) { $n = $v->int($k); if ($n < 0 || $n > 120) { $v->errors[] = ['code' => 'invalid', 'path' => [$k], 'message' => 'Must be between 0 and 120']; } return $n; }, true],
                'half_day_minutes' => [function ($v, $k) { $n = $v->int($k); if ($n < 0 || $n > 600) { $v->errors[] = ['code' => 'invalid', 'path' => [$k], 'message' => 'Must be between 0 and 600']; } return $n; }, true],
                'weekly_offs' => [fn($v, $k) => $v->regex($k, '/^[0-6](,[0-6])*$|^$/', 'Invalid weekly offs'), true],
                'status' => $status,
            ];
        case 'leave_types':
            return [
                'name' => [fn($v, $k) => $v->str($k, 1, 60), true],
                'code' => [fn($v, $k) => $v->str($k, 1, 10), true],
                'color' => [fn($v, $k) => $v->regex($k, '/^#[0-9a-fA-F]{6}$/', 'Invalid colour'), false],
                'annual_quota' => [fn($v, $k) => $v->num($k, 0, 365), true],
                'carry_forward_max' => [fn($v, $k) => $v->num($k, 0, 365), false],
                'is_paid' => [fn($v, $k) => $v->bool($k), false],
                'allow_half_day' => [fn($v, $k) => $v->bool($k), false],
                'count_weekoffs' => [fn($v, $k) => $v->bool($k), false],
                'status' => $status,
            ];
        default: // holidays
            return ['date' => [fn($v, $k) => $v->date($k), true], 'name' => [fn($v, $k) => $v->str($k, 1, 100), true], 'is_optional' => [fn($v, $k) => $v->bool($k), false]];
    }
}
function org_row(string $table, $id): array
{
    $row = q_one("SELECT * FROM `$table` WHERE id = ?", [(int) $id]);
    if (!$row) {
        throw new HttpError(404, 'Not found');
    }
    return $row;
}
function org_clean(array $d): array
{
    foreach ($d as $k => $val) {
        if (is_bool($val)) { $d[$k] = $val ? 1 : 0; }
    }
    return $d;
}
function org_list(string $table, string $orderBy): void { respond(q_all("SELECT * FROM `$table` ORDER BY `$orderBy`")); }
function org_create(string $table, string $entity): void
{
    $data = parse_spec(req_body(), org_spec($table));
    $id = q_insert($table, org_clean($data) + ['created_at' => ts(), 'updated_at' => ts()]);
    audit($entity, $id, 'create', null, $data);
    respond(org_row($table, $id), 201);
}
function org_update(string $table, string $entity, array $p): void
{
    $data = parse_spec(req_body(), org_spec($table), true);
    $before = org_row($table, $p['id']);
    q_update($table, org_clean($data) + ['updated_at' => ts()], 'id = ?', [$before['id']]);
    $after = org_row($table, $before['id']);
    audit($entity, $before['id'], 'update', $before, $after);
    respond($after);
}
function org_remove(string $table, string $entity, bool $hard, array $p): void
{
    $before = org_row($table, $p['id']);
    if ($hard) {
        q_exec("DELETE FROM `$table` WHERE id = ?", [$before['id']]);
    } else {
        q_update($table, ['status' => 'inactive'], 'id = ?', [$before['id']]);
    }
    audit($entity, $before['id'], $hard ? 'delete' : 'deactivate', $before, null);
    no_content();
}
