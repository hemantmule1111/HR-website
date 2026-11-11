<?php
// Multi-company support: finding the company a request belongs to, creating companies, and the platform owner's area.
// Mirrors server/src/services/tenants.js, server/src/middleware/tenant.js and server/src/controllers/platform.js.

const TENANT_RESERVED = ['platform', 'api', 'login', 'admin', 'candidate-test', 'documentation', 'www'];

function company_by_code(string $code): ?array { return q_one('SELECT * FROM companies WHERE code = ?', [strtolower(trim($code))]); }
function company_by_id(int $id): ?array { return q_one('SELECT * FROM companies WHERE id = ?', [$id]); }
// When only one company exists, requests that name none belong to it (keeps single-company installs working).
function company_sole(): ?array
{
    $rows = q_all('SELECT * FROM companies LIMIT 2');
    return count($rows) === 1 ? $rows[0] : null;
}

function company_assert_usable(array $c): void
{
    if ($c['status'] !== 'active') {
        throw new HttpError(403, 'This company account is suspended. Please contact support.');
    }
    if (!empty($c['valid_until']) && substr((string) $c['valid_until'], 0, 10) < today()) {
        throw new HttpError(403, 'This company subscription has ended. Please contact support.');
    }
}

// Decides which company this request belongs to and switches the database layer to that company's tables.
function tenant_resolve(): void
{
    $company = null;
    $h = req_headers();
    $raw = $h['authorization'] ?? '';
    $bearer = stripos($raw, 'Bearer ') === 0 ? substr($raw, 7) : '';
    $claim = $bearer !== '' ? jwt_verify($bearer) : null;
    if ($claim && !empty($claim['cid'])) {
        $company = company_by_id((int) $claim['cid']);
    }
    if (!$company && !empty($_COOKIE['refresh'])) {
        $r = jwt_verify((string) $_COOKIE['refresh']);
        if ($r && !empty($r['cid'])) {
            $company = company_by_id((int) $r['cid']);
        }
    }
    if (!$company && $_SERVER['REQUEST_METHOD'] !== 'GET') { // a password-reset link, or the second step of signing in, names its company
        $in = req_body();
        $ch = isset($in['challenge']) && is_string($in['challenge']) ? jwt_verify($in['challenge']) : null;
        if ($ch && !empty($ch['cid']) && !empty($ch['tf'])) {
            $company = company_by_id((int) $ch['cid']);
        }
        $rt = isset($in['token']) && is_string($in['token']) ? jwt_verify($in['token']) : null;
        if ($rt && !empty($rt['cid']) && !empty($rt['rp'])) {
            $company = company_by_id((int) $rt['cid']);
        }
    }
    $deviceKey = (string) ($h['x-device-key'] ?? ''); // a biometric machine names its company in its key
    if (!$company && strpos($deviceKey, '.') !== false) {
        $company = company_by_id((int) explode('.', $deviceKey)[0]);
    }
    $testToken = (string) ($h['x-test-token'] ?? '');
    if (!$company && strpos($testToken, '.') !== false) {
        $company = company_by_id((int) explode('.', $testToken)[0]);
    }
    if (!$company) {
        $host = strtolower(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]);
        $company = $host !== '' ? company_by_domain($host) : null; // the company's own web address
    }
    if (!$company) {
        $in = $_SERVER['REQUEST_METHOD'] === 'GET' ? [] : req_body();
        $code = $_GET['c'] ?? ($in['company'] ?? ($h['x-company'] ?? ''));
        if (is_string($code) && trim($code) !== '') {
            $company = company_by_code($code);
            if (!$company) {
                throw new HttpError(404, 'We could not find that company code. Please check it.');
            }
        } else {
            $company = company_sole();
        }
    }
    if (!$company && ($bearer !== '' || $testToken !== '')) {
        throw new HttpError(401, 'Your session has ended. Please sign in again.'); // a token that names no company
    }
    if (!$company) {
        tenant_none(); // fails closed: any company table is refused
        return;
    }
    company_assert_usable($company);
    $GLOBALS['COMPANY'] = $company;
    tenant_set((string) $company['prefix']);
    company_expiry_reminder($company);
}

// Once a day, in the last 7 days of a subscription, email the company admin and the platform owner. Triggered by normal use of the site.
function company_expiry_reminder(array $c): void
{
    if (empty($c['valid_until'])) {
        return;
    }
    $days = (int) floor((strtotime(substr((string) $c['valid_until'], 0, 10) . ' UTC') - strtotime(today() . ' UTC')) / 86400);
    if ($days > 7 || $days < 0) {
        return;
    }
    $mark = rl_dir() . '/expiry-' . (int) $c['id'] . '-' . today() . '.mark';
    if (is_file($mark)) {
        return;
    }
    @touch($mark);
    $when = $days === 0 ? 'today' : ($days === 1 ? 'tomorrow' : "in $days days");
    $end = substr((string) $c['valid_until'], 0, 10);
    $role = q_one('SELECT id FROM roles WHERE name = ?', ['Super Admin']);
    $admins = $role ? q_col('SELECT email FROM users WHERE role_id = ? AND is_active = 1', [$role['id']]) : [];
    foreach ($admins as $to) {
        mail_queue($to, 'Your WorkPilot subscription ends ' . $when, mail_html($c['name'], 'Your subscription ends ' . $when, ["The WorkPilot subscription for {$c['name']} ends on $end. After that date nobody in your company can sign in until it is renewed. Your data is kept.", 'Please contact your WorkPilot provider to renew.']));
    }
    foreach (q_col('SELECT email FROM platform_admins') as $to) {
        mail_queue($to, "{$c['name']} subscription ends $when", mail_html('WorkPilot platform', "{$c['name']} ends $when", ["Company {$c['name']} (code {$c['code']}) is valid until $end."]));
    }
}
function company(): ?array { return $GLOBALS['COMPANY'] ?? null; }

// ---------- creating and upgrading companies ----------
function tenant_exec_schema(string $prefix, array $statements): void
{
    foreach ($statements as $s) {
        db()->exec(str_replace('{P}', $prefix, $s)); // already carries the company's table names, so it bypasses the name rewriting
    }
}

function tenant_drop_tables(string $prefix): void
{
    db()->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach (array_reverse(tenant_schema()['tables']) as $t) {
        db()->exec('DROP TABLE IF EXISTS `' . $prefix . $t . '`');
    }
    db()->exec('SET FOREIGN_KEY_CHECKS = 1');
}

function tenant_probe(string $sql): bool
{
    try {
        db()->query($sql)->closeCursor();
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

// For a site that existed before companies: which company migrations are already in its tables?
function tenant_detect_version(string $prefix): int
{
    $has = fn(string $t) => tenant_probe('SELECT 1 FROM `' . $prefix . $t . '` LIMIT 1');
    if ($has('test_templates')) { return 9; }
    if ($has('overtime_settings')) { return 8; }
    if ($has('salary_components')) { return 7; }
    if (tenant_probe('SELECT travelling_allowance FROM `' . $prefix . 'payslips` LIMIT 1')) { return 6; }
    if ($has('statutory_rules')) { return 5; }
    return 4;
}

function tenant_provision(array $d): array
{
    $code = strtolower(trim((string) $d['code']));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/', $code) || in_array($code, TENANT_RESERVED, true)) {
        throw new HttpError(400, 'Company code: 3 to 40 letters, numbers or hyphens (for example acme-pvt)');
    }
    if (company_by_code($code)) {
        throw new HttpError(409, 'That company code is already taken');
    }
    $id = q_insert('companies', ['code' => $code, 'name' => $d['name'], 'prefix' => '', 'status' => 'active', 'max_employees' => $d['max_employees'], 'valid_until' => $d['valid_until'], 'notes' => $d['notes'], 'schema_version' => 0, 'created_at' => ts(), 'updated_at' => ts()]);
    $prefix = 'c' . $id . '_';
    q_update('companies', ['prefix' => $prefix], 'id = ?', [$id]);
    $schema = tenant_schema();
    try {
        foreach ($schema['migrations'] as $m) {
            tenant_exec_schema($prefix, $m['statements']);
        }
        tenant_exec_schema($prefix, $schema['seed']);
        tenant_with($prefix, function () use ($d) {
            q_update('company_profile', ['name' => $d['name']], 'id = ?', [1]);
            $role = q_one('SELECT id FROM roles WHERE name = ?', ['Super Admin']);
            q_insert('users', ['email' => $d['admin_email'], 'password_hash' => password_make($d['admin_password']), 'must_change_password' => 1, 'role_id' => $role['id'], 'created_at' => ts(), 'updated_at' => ts()]);
        });
        q_update('companies', ['schema_version' => $schema['version']], 'id = ?', [$id]);
    } catch (Throwable $e) {
        try { tenant_drop_tables($prefix); } catch (Throwable $ignored) { /* best effort */ }
        q_run('DELETE FROM companies WHERE id = ?', [$id]);
        throw $e;
    }
    return ['id' => $id, 'code' => $code, 'prefix' => $prefix];
}

function tenant_upgrade(array $c): array
{
    $schema = tenant_schema();
    $prefix = (string) $c['prefix'];
    $v = (int) $c['schema_version'];
    if ($v <= 0) { // an existing site whose tables pre-date companies: find out what it already has
        $v = tenant_detect_version($prefix);
    }
    $applied = 0;
    foreach (array_slice($schema['migrations'], $v) as $m) {
        tenant_exec_schema($prefix, $m['statements']);
        $applied++;
        q_update('companies', ['schema_version' => $v + $applied, 'updated_at' => ts()], 'id = ?', [$c['id']]);
    }
    if ($applied === 0) {
        q_update('companies', ['schema_version' => $v, 'updated_at' => ts()], 'id = ?', [$c['id']]);
    }
    return ['applied' => $applied];
}

function tenant_stats(array $c): array
{
    try {
        return tenant_with((string) $c['prefix'], fn() => [
            'employees' => (int) q_val("SELECT COUNT(*) FROM employees WHERE status != 'exited'"),
            'users' => (int) q_val('SELECT COUNT(*) FROM users WHERE is_active = 1'),
        ]);
    } catch (Throwable $e) {
        return ['employees' => null, 'users' => null, 'error' => 'Tables not ready. Press "Update databases".'];
    }
}

function tenant_admin_email(array $c): ?string
{
    try {
        return tenant_with((string) $c['prefix'], function () {
            $role = q_one('SELECT id FROM roles WHERE name = ?', ['Super Admin']);
            $u = $role ? q_one('SELECT email FROM users WHERE role_id = ? ORDER BY id LIMIT 1', [$role['id']]) : null;
            return $u['email'] ?? null;
        });
    } catch (Throwable $e) {
        return null;
    }
}

// ---------- platform owner ----------
function plat_sign(array $a): string { return jwt_sign(['pa' => (int) $a['id']], 8 * 3600); }

// Platform two-step data lives in platform_2fa. The table is created on first use, so a site that was set up earlier needs no extra SQL.
function plat_2fa_row(int $id): array
{
    for ($try = 0; $try < 2; $try++) {
        try {
            return q_one('SELECT * FROM platform_2fa WHERE admin_id = ?', [$id]) ?: ['admin_id' => $id, 'secret' => null, 'enabled' => 0, 'recovery_codes' => null, 'last_step' => 0];
        } catch (PDOException $e) {
            if ($try === 1) {
                throw $e;
            }
            db()->exec('CREATE TABLE IF NOT EXISTS platform_2fa (admin_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, secret TEXT NULL, enabled TINYINT(1) NOT NULL DEFAULT 0, recovery_codes TEXT NULL, last_step INT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        }
    }
    return [];
}

// The platform owner must use two-step sign-in. Until it is set up, only the setup calls work.
function plat_require(): array
{
    plat_ensure_schema();
    $raw = req_headers()['authorization'] ?? '';
    $p = jwt_verify(stripos($raw, 'Bearer ') === 0 ? substr($raw, 7) : '');
    $a = $p && !empty($p['pa']) && empty($p['tf']) ? q_one('SELECT * FROM platform_admins WHERE id = ?', [(int) $p['pa']]) : null;
    if (!$a) {
        throw new HttpError(401, 'Platform sign-in required');
    }
    $GLOBALS['PLAT2FA'] = plat_2fa_row((int) $a['id']);
    if (!$GLOBALS['PLAT2FA']['enabled'] && !in_array($GLOBALS['ROUTE'] ?? '', ['/platform/me', '/platform/2fa', '/platform/2fa/setup', '/platform/2fa/enable'], true)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Set up two-step sign-in first.', 'code' => 'TWO_FACTOR_SETUP_REQUIRED']);
        exit;
    }
    return $a;
}

function plat_login(): void
{
    rl_limit('plogin:' . client_ip(), 10, 900, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $email = strtolower($v->email('email'));
    $password = $v->str('password', 1, 1000);
    $v->done();
    $a = q_one('SELECT * FROM platform_admins WHERE email = ?', [$email]);
    if ($a && $a['locked_until'] && parse_ts($a['locked_until']) > time()) {
        throw new HttpError(423, 'Account temporarily locked. Try again later.');
    }
    if (!$a || !password_ok($password, $a['password_hash'])) {
        if ($a) {
            $fails = (int) $a['failed_logins'] + 1;
            q_update('platform_admins', $fails >= 5 ? ['failed_logins' => 0, 'locked_until' => ts(time() + 15 * 60)] : ['failed_logins' => $fails], 'id = ?', [$a['id']]);
        }
        throw new HttpError(401, 'Invalid email or password');
    }
    q_update('platform_admins', ['failed_logins' => 0, 'locked_until' => null], 'id = ?', [$a['id']]);
    plat_log($a, 'sign_in', null, 'Password accepted');
    $t = plat_2fa_row((int) $a['id']);
    if ($t['enabled']) {
        respond(['twoFactor' => true, 'challenge' => jwt_sign(['pa' => (int) $a['id'], 'tf' => 1], 300)]);
    }
    respond(['token' => plat_sign($a), 'name' => $a['name'], 'email' => $a['email'], 'setupRequired' => true]);
}

// Second step: the code from the authenticator app (or a recovery code).
function plat_verify(): void
{
    rl_limit('pverify:' . client_ip(), 10, 900, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $challenge = $v->str('challenge', 10, 2000);
    $code = $v->str('code', 6, 20);
    $v->done();
    $p = jwt_verify($challenge);
    $a = $p && !empty($p['tf']) && !empty($p['pa']) ? q_one('SELECT * FROM platform_admins WHERE id = ?', [(int) $p['pa']]) : null;
    if (!$a) {
        throw new HttpError(401, 'That sign-in has expired. Please start again.');
    }
    if ($a['locked_until'] && parse_ts($a['locked_until']) > time()) {
        throw new HttpError(423, 'Account temporarily locked. Try again later.');
    }
    $t = plat_2fa_row((int) $a['id']);
    $clean = preg_replace('/\s+/', '', $code);
    $ok = false;
    $patch = [];
    if (preg_match('/^\d{6}$/', $clean)) {
        $step = totp_verify(totp_decrypt($t['secret']), $clean, (int) $t['last_step']);
        if ($step) { $ok = true; $patch['last_step'] = $step; }
    } else {
        $left = totp_use_recovery($t['recovery_codes'], $clean);
        if ($left !== null) { $ok = true; $patch['recovery_codes'] = json_encode($left); }
    }
    if (!$ok) {
        $fails = (int) $a['failed_logins'] + 1;
        q_update('platform_admins', $fails >= 5 ? ['failed_logins' => 0, 'locked_until' => ts(time() + 15 * 60)] : ['failed_logins' => $fails], 'id = ?', [$a['id']]);
        throw new HttpError(401, 'That code is not correct. Try the newest code from your app, or use a recovery code.');
    }
    q_update('platform_2fa', $patch, 'admin_id = ?', [$a['id']]);
    respond(['token' => plat_sign($a), 'name' => $a['name'], 'email' => $a['email']]);
}

function plat_2fa_status(): void
{
    plat_require();
    $t = $GLOBALS['PLAT2FA'];
    respond(['enabled' => (bool) $t['enabled'], 'required' => true, 'recovery_left' => $t['enabled'] ? count(json_decode((string) $t['recovery_codes'], true) ?: []) : 0]);
}

function plat_2fa_setup(): void
{
    $a = plat_require();
    if ($GLOBALS['PLAT2FA']['enabled']) {
        throw new HttpError(400, 'Two-step sign-in is already on');
    }
    $secret = totp_new_secret();
    if (q_one('SELECT admin_id FROM platform_2fa WHERE admin_id = ?', [$a['id']])) {
        q_update('platform_2fa', ['secret' => totp_encrypt($secret), 'last_step' => 0], 'admin_id = ?', [$a['id']]);
    } else {
        q_insert('platform_2fa', ['admin_id' => $a['id'], 'secret' => totp_encrypt($secret)]);
    }
    respond(['secret' => $secret, 'otpauth' => totp_otpauth('WorkPilot Platform', $a['email'], $secret)]);
}

function plat_2fa_enable(): void
{
    $a = plat_require();
    rl_limit('pverify:' . client_ip(), 10, 900, 'Too many attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $code = $v->str('code', 6, 20);
    $v->done();
    $t = $GLOBALS['PLAT2FA'];
    if ($t['enabled']) {
        throw new HttpError(400, 'Two-step sign-in is already on');
    }
    if (!$t['secret']) {
        throw new HttpError(400, 'Start the setup first');
    }
    $step = totp_verify(totp_decrypt($t['secret']), $code, 0);
    if (!$step) {
        throw new HttpError(400, 'That code is not correct. Check the time on your phone and try the next code.');
    }
    $rc = totp_new_recovery_codes();
    q_update('platform_2fa', ['enabled' => 1, 'last_step' => $step, 'recovery_codes' => json_encode($rc['hashes'])], 'admin_id = ?', [$a['id']]);
    respond(['recovery_codes' => $rc['codes']]);
}

function plat_2fa_recovery(): void
{
    $a = plat_require();
    $v = new V(req_body());
    $code = $v->str('code', 6, 20);
    $v->done();
    $t = $GLOBALS['PLAT2FA'];
    $step = $t['enabled'] ? totp_verify(totp_decrypt($t['secret']), $code, (int) $t['last_step']) : null;
    if (!$step) {
        throw new HttpError(400, 'That code is not correct');
    }
    $rc = totp_new_recovery_codes();
    q_update('platform_2fa', ['last_step' => $step, 'recovery_codes' => json_encode($rc['hashes'])], 'admin_id = ?', [$a['id']]);
    respond(['recovery_codes' => $rc['codes']]);
}

function plat_me(): void
{
    $a = plat_require();
    respond(['id' => (int) $a['id'], 'name' => $a['name'], 'email' => $a['email']]);
}

function plat_change_password(): void
{
    $a = plat_require();
    $v = new V(req_body());
    $cur = $v->str('currentPassword', 0, 1000);
    $new = $v->str('newPassword', 10, 128);
    $v->done();
    if (!password_ok($cur, $a['password_hash'])) {
        throw new HttpError(400, 'Current password is incorrect');
    }
    password_require_strong($new, $a['email']);
    q_update('platform_admins', ['password_hash' => password_make($new)], 'id = ?', [$a['id']]);
    no_content();
}

function plat_shape(array $c, array $extra = []): array
{
    return [
        'id' => (int) $c['id'], 'code' => $c['code'], 'name' => $c['name'], 'status' => $c['status'], 'max_employees' => (int) $c['max_employees'],
        'valid_until' => $c['valid_until'] ? substr((string) $c['valid_until'], 0, 10) : null, 'notes' => $c['notes'], 'created_at' => $c['created_at'], 'schema_version' => (int) $c['schema_version'],
        'plan' => $c['plan'] ?? null, 'domain' => $c['domain'] ?? null, 'features' => features_of($c), 'last_login_at' => $c['last_login_at'] ?? null,
    ] + $extra;
}

function plat_list(): void
{
    plat_require();
    $out = [];
    foreach (q_all('SELECT * FROM companies ORDER BY id') as $c) {
        $out[] = plat_shape($c, tenant_stats($c) + ['admin_email' => tenant_admin_email($c)]);
    }
    respond($out);
}

function plat_create(): void
{
    $adm = plat_require();
    $v = new V(req_body());
    $d = [
        'name' => $v->str('name', 2, 150), 'code' => $v->str('code', 3, 40), 'admin_email' => strtolower($v->email('admin_email')),
        'admin_password' => $v->str('admin_password', 10, 128),
        'max_employees' => $v->has('max_employees') && $v->in['max_employees'] !== '' ? (int) $v->num('max_employees', 0, 100000) : 0,
        'valid_until' => $v->has('valid_until') && $v->in['valid_until'] ? $v->date('valid_until') : null,
        'notes' => $v->optStr('notes', 1000),
    ];
    $v->done();
    $in = req_body();
    $plan = isset($in['plan']) && $in['plan'] !== '' ? mb_substr(trim((string) $in['plan']), 0, 40) : null;
    $domain = plat_domain_input($in['domain'] ?? '');
    if ($domain && q_one('SELECT id FROM companies WHERE domain = ?', [$domain])) {
        throw new HttpError(409, 'That web address is already used by another company');
    }
    password_require_strong($d['admin_password'], $d['admin_email']);
    $r = tenant_provision($d);
    $feat = [];
    foreach (array_keys(FEATURES) as $k) {
        if (isset($in['features'][$k])) { $feat[$k] = (bool) $in['features'][$k]; }
    }
    q_update('companies', ['plan' => $plan, 'features' => $feat ? json_encode($feat) : null, 'domain' => $domain], 'id = ?', [$r['id']]);
    plat_log($adm, 'company_create', $r, $d['name'] . ($plan ? ', plan ' . $plan : ''));
    respond($r, 201);
}

function plat_update(array $p): void
{
    $adm = plat_require();
    $c = company_by_id((int) $p['id']);
    if (!$c) {
        throw new HttpError(404, 'Company not found');
    }
    $in = req_body();
    $d = [];
    if (isset($in['name'])) {
        $name = trim((string) $in['name']);
        if (mb_strlen($name) < 2 || mb_strlen($name) > 150) { throw new HttpError(400, 'Name must be 2 to 150 characters'); }
        $d['name'] = $name;
    }
    if (isset($in['code'])) {
        $code = strtolower(trim((string) $in['code']));
        if ($code !== $c['code']) {
            if (!preg_match('/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/', $code) || in_array($code, TENANT_RESERVED, true)) {
                throw new HttpError(400, 'Company code: 3 to 40 letters, numbers or hyphens');
            }
            if (q_one('SELECT id FROM companies WHERE code = ? AND id != ?', [$code, $c['id']])) {
                throw new HttpError(409, 'That company code is already taken');
            }
            $d['code'] = $code;
        }
    }
    if (isset($in['status'])) {
        if (!in_array($in['status'], ['active', 'suspended'], true)) { throw new HttpError(400, 'Invalid status'); }
        $d['status'] = $in['status'];
    }
    if (isset($in['max_employees'])) {
        if (!is_numeric($in['max_employees']) || (int) $in['max_employees'] < 0 || (int) $in['max_employees'] > 100000) { throw new HttpError(400, 'Employee limit must be 0 or more'); }
        $d['max_employees'] = (int) $in['max_employees'];
    }
    if (array_key_exists('valid_until', $in)) {
        if ($in['valid_until'] !== null && $in['valid_until'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $in['valid_until'])) { throw new HttpError(400, 'Use YYYY-MM-DD'); }
        $d['valid_until'] = $in['valid_until'] ?: null;
    }
    if (array_key_exists('notes', $in)) {
        $d['notes'] = $in['notes'] === null ? null : mb_substr((string) $in['notes'], 0, 1000);
    }
    if (array_key_exists('plan', $in)) {
        $d['plan'] = $in['plan'] === null || $in['plan'] === '' ? null : mb_substr(trim((string) $in['plan']), 0, 40);
    }
    if (array_key_exists('domain', $in)) {
        $d['domain'] = plat_domain_input($in['domain']);
        if ($d['domain'] && q_one('SELECT id FROM companies WHERE domain = ? AND id != ?', [$d['domain'], $c['id']])) {
            throw new HttpError(409, 'That web address is already used by another company');
        }
    }
    $feat = null;
    if (isset($in['features']) && is_array($in['features'])) {
        $feat = features_of($c);
        foreach (array_keys(FEATURES) as $k) {
            if (isset($in['features'][$k])) { $feat[$k] = (bool) $in['features'][$k]; }
        }
        $d['features'] = json_encode($feat);
    }
    if ($d) {
        q_update('companies', $d + ['updated_at' => ts()], 'id = ?', [$c['id']]);
    }
    $what = implode(', ', array_map(fn($k) => $k === 'features' ? 'features ' . json_encode($in['features']) : ($k === 'status' ? 'status ' . $d['status'] : $k), array_keys($d)));
    plat_log($adm, isset($d['status']) ? ($d['status'] === 'suspended' ? 'company_suspend' : 'company_activate') : 'company_update', $c, $what);
    respond(['ok' => true]);
}

function plat_reset_admin(array $p): void
{
    $adm = plat_require();
    $c = company_by_id((int) $p['id']);
    if (!$c) {
        throw new HttpError(404, 'Company not found');
    }
    $v = new V(req_body());
    $email = $v->has('email') && $v->in['email'] !== '' ? strtolower($v->email('email')) : null;
    $password = $v->str('password', 10, 128);
    $v->done();
    password_require_strong($password, $email);
    $res = tenant_with((string) $c['prefix'], function () use ($email, $password) {
        $role = q_one('SELECT id FROM roles WHERE name = ?', ['Super Admin']);
        $admin = q_one('SELECT * FROM users WHERE role_id = ? ORDER BY id LIMIT 1', [$role['id']]);
        if (!$admin) {
            if (!$email) { throw new HttpError(400, 'This company has no admin yet. Enter an admin email.'); }
            q_insert('users', ['email' => $email, 'password_hash' => password_make($password), 'must_change_password' => 1, 'role_id' => $role['id'], 'created_at' => ts(), 'updated_at' => ts()]);
            return ['email' => $email];
        }
        q_update('users', ['password_hash' => password_make($password), 'failed_logins' => 0, 'locked_until' => null, 'must_change_password' => 1, 'totp_enabled' => 0, 'totp_secret' => null, 'recovery_codes' => null, 'totp_last_step' => 0] + ($email ? ['email' => $email] : []), 'id = ?', [$admin['id']]);
        return ['email' => $email ?: $admin['email']];
    });
    plat_log($adm, 'admin_reset', $c, 'Admin login ' . $res['email']);
    respond($res);
}

// Lets the platform owner check that email works (used after setting up SMTP in app/config.php).
function plat_test_email(): void
{
    plat_require();
    $v = new V(req_body());
    $to = $v->email('to');
    $v->done();
    $r = mail_send($to, 'WorkPilot test email', mail_html('WorkPilot', 'Email is working', ['This is a test email from your WorkPilot site.', 'If you can read this, password resets, welcome emails and notifications will reach people.']));
    respond($r);
}

function plat_upgrade(): void
{
    plat_require();
    $out = [];
    foreach (q_all('SELECT * FROM companies ORDER BY id') as $c) {
        try {
            $out[] = ['code' => $c['code']] + tenant_upgrade($c);
        } catch (Throwable $e) {
            $out[] = ['code' => $c['code'], 'error' => $e->getMessage()];
        }
    }
    respond($out);
}
