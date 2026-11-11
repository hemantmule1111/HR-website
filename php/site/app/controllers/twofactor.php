<?php
// Two-step sign-in for company users. Mirrors server/src/controllers/twoFactor.js.

function tf_required(): bool
{
    foreach (['user.manage', 'payroll.manage', 'org.manage'] as $k) {
        if (!has_perm($k)) {
            return false;
        }
    }
    return true; // Super Admins must use it
}
function tf_user(): array { return q_one('SELECT * FROM users WHERE id = ?', [user()['id']]); }

function tf_status(): void
{
    $u = tf_user();
    respond(['enabled' => (bool) $u['totp_enabled'], 'required' => tf_required(), 'recovery_left' => $u['totp_enabled'] ? count(json_decode((string) $u['recovery_codes'], true) ?: []) : 0]);
}

// Step 1: a new secret to scan or type into the authenticator app. It is not active until a first code is confirmed.
function tf_setup(): void
{
    $u = tf_user();
    if ($u['totp_enabled']) {
        throw new HttpError(400, 'Two-step sign-in is already on');
    }
    $secret = totp_new_secret();
    q_update('users', ['totp_secret' => totp_encrypt($secret), 'totp_last_step' => 0], 'id = ?', [$u['id']]);
    respond(['secret' => $secret, 'otpauth' => totp_otpauth('WorkPilot (' . company()['code'] . ')', $u['email'], $secret)]);
}

function tf_code_input(): string
{
    $v = new V(req_body());
    $c = $v->str('code', 6, 20);
    $v->done();
    return $c;
}

// Step 2: the app's first code proves it works. Recovery codes are shown once.
function tf_enable(): void
{
    rl_limit('2fa:' . client_ip(), 20, 900, 'Too many attempts. Please wait 15 minutes and try again.');
    $code = tf_code_input();
    $u = tf_user();
    if ($u['totp_enabled']) {
        throw new HttpError(400, 'Two-step sign-in is already on');
    }
    if (!$u['totp_secret']) {
        throw new HttpError(400, 'Start the setup first');
    }
    $step = totp_verify(totp_decrypt($u['totp_secret']), $code, 0);
    if (!$step) {
        throw new HttpError(400, 'That code is not correct. Check the time on your phone and try the next code.');
    }
    $rc = totp_new_recovery_codes();
    q_update('users', ['totp_enabled' => 1, 'totp_last_step' => $step, 'recovery_codes' => json_encode($rc['hashes'])], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'two_factor_enable');
    respond(['recovery_codes' => $rc['codes']]);
}

// Needs the password and a current code. Super Admins cannot switch it off.
function tf_disable(): void
{
    rl_limit('2fa:' . client_ip(), 20, 900, 'Too many attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $password = $v->str('password', 1, 1000);
    $code = $v->str('code', 6, 20);
    $v->done();
    if (tf_required()) {
        throw new HttpError(400, 'Two-step sign-in is required for administrators and cannot be switched off.');
    }
    $u = tf_user();
    if (!$u['totp_enabled']) {
        throw new HttpError(400, 'Two-step sign-in is not on');
    }
    if (!password_ok($password, $u['password_hash'])) {
        throw new HttpError(400, 'Password is incorrect');
    }
    if (!totp_verify(totp_decrypt($u['totp_secret']), $code, (int) $u['totp_last_step'])) {
        throw new HttpError(400, 'That code is not correct');
    }
    q_update('users', ['totp_enabled' => 0, 'totp_secret' => null, 'recovery_codes' => null, 'totp_last_step' => 0], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'two_factor_disable');
    no_content();
}

function tf_regenerate(): void
{
    rl_limit('2fa:' . client_ip(), 20, 900, 'Too many attempts. Please wait 15 minutes and try again.');
    $code = tf_code_input();
    $u = tf_user();
    if (!$u['totp_enabled']) {
        throw new HttpError(400, 'Two-step sign-in is not on');
    }
    $step = totp_verify(totp_decrypt($u['totp_secret']), $code, (int) $u['totp_last_step']);
    if (!$step) {
        throw new HttpError(400, 'That code is not correct');
    }
    $rc = totp_new_recovery_codes();
    q_update('users', ['totp_last_step' => $step, 'recovery_codes' => json_encode($rc['hashes'])], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'two_factor_new_recovery_codes');
    respond(['recovery_codes' => $rc['codes']]);
}

// The second step of signing in (public: the person has proved the password and holds a short-lived challenge).
function tf_verify_login(): void
{
    rl_limit('2fa:' . client_ip(), 20, 900, 'Too many attempts. Please wait 15 minutes and try again.');
    $v = new V(req_body());
    $challenge = $v->str('challenge', 10, 2000);
    $code = $v->str('code', 6, 20);
    $v->done();
    $p = jwt_verify($challenge);
    if (!$p || empty($p['tf']) || !company() || (int) ($p['cid'] ?? 0) !== (int) company()['id']) {
        throw new HttpError(401, 'That sign-in has expired. Please start again.');
    }
    $u = q_one('SELECT * FROM users WHERE id = ? AND is_active = 1', [(int) $p['sub']]);
    if (!$u || !$u['totp_enabled']) {
        throw new HttpError(401, 'That sign-in has expired. Please start again.');
    }
    if ($u['locked_until'] && parse_ts($u['locked_until']) > time()) {
        throw new HttpError(423, 'Account temporarily locked. Try again later.');
    }
    $clean = preg_replace('/\s+/', '', $code);
    $patch = [];
    $ok = false;
    if (preg_match('/^\d{6}$/', $clean)) {
        $step = totp_verify(totp_decrypt($u['totp_secret']), $clean, (int) $u['totp_last_step']);
        if ($step) { $ok = true; $patch['totp_last_step'] = $step; }
    } else {
        $left = totp_use_recovery($u['recovery_codes'], $clean);
        if ($left !== null) { $ok = true; $patch['recovery_codes'] = json_encode($left); }
    }
    if (!$ok) {
        $fails = (int) $u['failed_logins'] + 1;
        q_update('users', $fails >= MAX_FAILS ? ['failed_logins' => 0, 'locked_until' => ts(time() + LOCK_MIN * 60)] : ['failed_logins' => $fails], 'id = ?', [$u['id']]);
        throw new HttpError(401, 'That code is not correct. Try the newest code from your app, or use a recovery code.');
    }
    q_update('users', $patch, 'id = ?', [$u['id']]);
    auth_issue_session($u);
}

// An administrator (user.manage) removes a colleague's two-step setup, for example after a lost phone.
function tf_reset_for(array $p): void
{
    $u = q_one('SELECT * FROM users WHERE id = ?', [(int) $p['id']]);
    if (!$u) {
        throw new HttpError(404, 'User not found');
    }
    q_update('users', ['totp_enabled' => 0, 'totp_secret' => null, 'recovery_codes' => null, 'totp_last_step' => 0], 'id = ?', [$u['id']]);
    audit('user', $u['id'], 'two_factor_reset');
    no_content();
}
