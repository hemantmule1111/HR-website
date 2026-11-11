<?php
// Selling to many companies: feature switches, own web address, the platform dashboard, the owner's activity log,
// the support health view and safe delete. Mirrors server/src/services/features.js and the second half of server/src/controllers/platform.js.

const FEATURES = [
    'payroll' => 'Payroll and payslips', 'overtime' => 'Overtime', 'tests' => 'HR tests', 'geo' => 'Attendance location check',
    'hrdesk' => 'Help desk, policies and assets', 'letters' => 'Letters', 'chat' => 'Chat',
];
const FEATURE_PREFIXES = [
    '/payroll' => 'payroll', '/overtime' => 'overtime', '/tests' => 'tests', '/test-candidates' => 'tests', '/candidate-test' => 'tests', '/geo' => 'geo',
    '/helpdesk' => 'hrdesk', '/policies' => 'hrdesk', '/assets' => 'hrdesk', '/letters' => 'letters', '/chat' => 'chat',
];

// A company with no switches saved has everything on.
function features_of(?array $company): array
{
    $saved = [];
    if (!empty($company['features'])) {
        $j = json_decode((string) $company['features'], true);
        $saved = is_array($j) ? $j : [];
    }
    $out = [];
    foreach (array_keys(FEATURES) as $k) {
        $out[$k] = !(array_key_exists($k, $saved) && $saved[$k] === false);
    }
    return $out;
}

// Refuses parts of the product the company's plan does not include.
function feature_gate(string $route): void
{
    foreach (FEATURE_PREFIXES as $prefix => $key) {
        if ($route === $prefix || strpos($route, $prefix . '/') === 0) {
            if (!empty($GLOBALS['COMPANY']) && !features_of($GLOBALS['COMPANY'])[$key]) {
                http_response_code(403);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['error' => FEATURES[$key] . ' is not included in your plan. Please contact your provider to add it.', 'code' => 'FEATURE_OFF']);
                exit;
            }
            return;
        }
    }
}

function company_by_domain(string $host): ?array
{
    try {
        return q_one('SELECT * FROM companies WHERE domain = ?', [strtolower($host)]);
    } catch (Throwable $e) {
        return null; // the platform tables have not been updated yet
    }
}

// Adds what this version needs to the platform tables of an older install (no SQL import needed).
function plat_ensure_schema(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $have = array_column(q_all('SHOW COLUMNS FROM companies'), 'Field');
    foreach (['plan' => 'VARCHAR(40) NULL', 'features' => 'TEXT NULL', 'domain' => 'VARCHAR(150) NULL', 'last_login_at' => 'TIMESTAMP NULL DEFAULT NULL'] as $col => $def) {
        if (!in_array($col, $have, true)) {
            db()->exec("ALTER TABLE companies ADD COLUMN $col $def");
            if ($col === 'domain') {
                db()->exec('ALTER TABLE companies ADD UNIQUE KEY companies_domain_unique (domain)');
            }
        }
    }
    db()->exec('CREATE TABLE IF NOT EXISTS platform_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_id BIGINT UNSIGNED NULL, admin_email VARCHAR(150) NULL, action VARCHAR(40) NOT NULL,
        company_id BIGINT UNSIGNED NULL, company_code VARCHAR(40) NULL, detail VARCHAR(500) NULL, ip VARCHAR(60) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, KEY platform_log_created_at_index (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
}

// The platform owner's activity log: who did what, to which company.
function plat_log(?array $admin, string $action, ?array $company = null, ?string $detail = null): void
{
    try {
        plat_ensure_schema();
        q_insert('platform_log', [
            'admin_id' => $admin['id'] ?? null, 'admin_email' => $admin['email'] ?? null, 'action' => $action, 'company_id' => $company['id'] ?? null,
            'company_code' => $company['code'] ?? null, 'detail' => $detail === null ? null : mb_substr($detail, 0, 500), 'ip' => client_ip(), 'created_at' => ts(),
        ]);
    } catch (Throwable $e) {
        error_log('WorkPilot platform log failed: ' . $e->getMessage());
    }
}

function plat_domain_input($raw): ?string
{
    $d = strtolower(trim((string) $raw));
    if ($d === '') {
        return null;
    }
    if (strlen($d) > 150 || !preg_match('/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/', $d)) {
        throw new HttpError(400, 'Enter a web address such as hr.acme.com');
    }
    return $d;
}

function plat_features(): void
{
    plat_require();
    respond(array_map(fn($k) => ['key' => $k, 'label' => FEATURES[$k]], array_keys(FEATURES)));
}

function dir_size(string $dir): int
{
    $n = 0;
    if (!is_dir($dir)) {
        return 0;
    }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        $n += $f->isFile() ? $f->getSize() : 0;
    }
    return $n;
}
function dir_remove(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($dir);
}
function plat_company_dir(array $c): string
{
    $root = rtrim(str_replace('\\', '/', cfg('upload_dir') ?: (__DIR__ . '/../storage/uploads')), '/');
    return $root . '/' . rtrim((string) $c['prefix'], '_');
}
function plat_days_to(?string $d): ?int
{
    return $d ? (int) floor((strtotime(substr($d, 0, 10) . ' UTC') - strtotime(today() . ' UTC')) / 86400) : null;
}

function plat_overview(): void
{
    plat_require();
    $list = [];
    foreach (q_all('SELECT * FROM companies ORDER BY id') as $c) {
        $s = tenant_stats($c);
        $list[] = [
            'id' => (int) $c['id'], 'code' => $c['code'], 'name' => $c['name'], 'plan' => $c['plan'] ?? null, 'status' => $c['status'], 'employees' => $s['employees'], 'users' => $s['users'],
            'max_employees' => (int) $c['max_employees'], 'valid_until' => $c['valid_until'] ? substr((string) $c['valid_until'], 0, 10) : null, 'days_left' => plat_days_to($c['valid_until']),
            'last_login_at' => $c['last_login_at'] ?? null, 'storage_bytes' => ((string) $c['prefix'] !== '' || true) ? dir_size(plat_company_dir($c)) : 0, 'created_at' => $c['created_at'],
        ];
    }
    $quiet = fn($c) => !$c['last_login_at'] || time() - parse_ts($c['last_login_at']) > 30 * 86400;
    respond([
        'totals' => [
            'companies' => count($list),
            'active' => count(array_filter($list, fn($c) => $c['status'] === 'active' && ($c['days_left'] === null || $c['days_left'] >= 0))),
            'suspended' => count(array_filter($list, fn($c) => $c['status'] !== 'active')),
            'expired' => count(array_filter($list, fn($c) => $c['days_left'] !== null && $c['days_left'] < 0)),
            'expiring_30' => count(array_filter($list, fn($c) => $c['days_left'] !== null && $c['days_left'] >= 0 && $c['days_left'] <= 30)),
            'quiet_30' => count(array_filter($list, $quiet)),
            'employees' => array_sum(array_map(fn($c) => (int) $c['employees'], $list)),
            'storage_bytes' => array_sum(array_column($list, 'storage_bytes')),
        ],
        'companies' => $list,
    ]);
}

function plat_log_list(): void
{
    plat_require();
    plat_ensure_schema();
    $limit = min(max((int) ($_GET['limit'] ?? 200), 1), 500);
    if (!empty($_GET['company'])) {
        respond(q_all('SELECT * FROM platform_log WHERE company_id = ? ORDER BY id DESC LIMIT ' . $limit, [(int) $_GET['company']]));
    }
    respond(q_all('SELECT * FROM platform_log ORDER BY id DESC LIMIT ' . $limit));
}

// Is this company healthy? Counts and settings only: no names, pay or documents of its people.
function plat_health(array $p): void
{
    plat_require();
    $c = company_by_id((int) $p['id']);
    if (!$c) {
        throw new HttpError(404, 'Company not found');
    }
    $schema = tenant_schema();
    $out = [
        'code' => $c['code'], 'name' => $c['name'], 'status' => $c['status'], 'plan' => $c['plan'] ?? null, 'domain' => $c['domain'] ?? null, 'features' => features_of($c),
        'schema' => ['applied' => (int) $c['schema_version'], 'expected' => (int) $schema['version'], 'up_to_date' => (int) $c['schema_version'] >= (int) $schema['version']],
        'last_login_at' => $c['last_login_at'] ?? null, 'storage_bytes' => dir_size(plat_company_dir($c)),
    ];
    try {
        $have = array_flip(q_col('SHOW TABLES'));
        $prefix = (string) $c['prefix'];
        $out['tables_missing'] = array_values(array_filter($schema['tables'], fn($t) => !isset($have[$prefix . $t])));
        $out += tenant_with($prefix, function () {
            $n = fn($sql, $args = []) => (int) q_val($sql, $args);
            $role = q_one('SELECT id FROM roles WHERE name = ?', ['Super Admin']);
            $admins = $role ? q_all('SELECT totp_enabled FROM users WHERE role_id = ? AND is_active = 1', [$role['id']]) : [];
            return [
                'employees' => $n("SELECT COUNT(*) FROM employees WHERE status != 'exited'"), 'users' => $n('SELECT COUNT(*) FROM users WHERE is_active = 1'),
                'users_signed_in_30_days' => $n('SELECT COUNT(*) FROM users WHERE last_login_at >= ?', [ts(time() - 30 * 86400)]),
                'admins' => count($admins), 'admins_with_two_step' => count(array_filter($admins, fn($a) => !empty($a['totp_enabled']))),
                'locked_users' => $n('SELECT COUNT(*) FROM users WHERE locked_until > ?', [ts()]),
                'payroll_runs' => $n('SELECT COUNT(*) FROM payroll_runs'), 'last_payroll_month' => q_val('SELECT MAX(month) FROM payroll_runs'),
                'attendance_punches_this_month' => $n('SELECT COUNT(*) FROM attendance WHERE date >= ?', [substr(today(), 0, 7) . '-01']),
            ];
        });
    } catch (Throwable $e) {
        $out['error'] = 'This company\'s tables are not ready. Press "Update databases".';
    }
    respond($out);
}

// Deleting a whole company: it must be suspended, its data exported in the last day, and the owner types the company code and their password.
function plat_delete(array $p): void
{
    $a = plat_require();
    plat_ensure_schema();
    $c = company_by_id((int) $p['id']);
    if (!$c) {
        throw new HttpError(404, 'Company not found');
    }
    $b = req_body();
    if ((string) $c['prefix'] === '') {
        throw new HttpError(400, 'The first company uses the original tables and cannot be deleted here.');
    }
    if ($c['status'] !== 'suspended') {
        throw new HttpError(400, 'Suspend the company first, so nobody is working in it while it is deleted.');
    }
    if (strtolower(trim((string) ($b['confirm_code'] ?? ''))) !== $c['code']) {
        throw new HttpError(400, 'Type the company code (' . $c['code'] . ') exactly to confirm.');
    }
    if (!password_ok((string) ($b['password'] ?? ''), $a['password_hash'])) {
        throw new HttpError(400, 'Your password is not correct');
    }
    if (!q_one("SELECT id FROM platform_log WHERE company_id = ? AND action = 'company_export' AND created_at >= ?", [$c['id'], ts(time() - 86400)])) {
        throw new HttpError(400, 'Download an export of this company first (Export, with files). The delete is only allowed within a day of an export, so the data can be restored if it was a mistake.');
    }
    tenant_drop_tables((string) $c['prefix']);
    dir_remove(plat_company_dir($c));
    q_run('DELETE FROM companies WHERE id = ?', [$c['id']]);
    plat_log($a, 'company_delete', $c, $c['name'] . ' (' . $c['code'] . ') deleted with all its data');
    respond(['ok' => true]);
}
