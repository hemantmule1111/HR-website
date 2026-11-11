<?php
// Loads the application and runs the request. Every /api/v1 request ends up here (see api/index.php).

ini_set('display_errors', '0');
error_reporting(E_ALL);
mb_internal_encoding('UTF-8');

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/services.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/mailer.php';
require __DIR__ . '/lib/totp.php';
require __DIR__ . '/lib/zip.php';
require __DIR__ . '/controllers/accounts.php';
require __DIR__ . '/controllers/employees.php';
require __DIR__ . '/controllers/attendance_leave.php';
require __DIR__ . '/controllers/comms_reports.php';
require __DIR__ . '/controllers/payroll_company.php';
require __DIR__ . '/controllers/chat.php';
require __DIR__ . '/controllers/overtime.php';
require __DIR__ . '/controllers/tests.php';
require __DIR__ . '/controllers/platform.php';
require __DIR__ . '/controllers/geo.php';
require __DIR__ . '/controllers/twofactor.php';
require __DIR__ . '/controllers/backup.php';
require __DIR__ . '/controllers/hrdesk.php';
require __DIR__ . '/controllers/letters.php';
require __DIR__ . '/controllers/payroll_compliance.php';
require __DIR__ . '/controllers/attendance_rules.php';
require __DIR__ . '/controllers/platform_extra.php';
require __DIR__ . '/routes.php';

// An email to the owner when the site hits an unexpected error. Set 'alert_email' in config.php (empty = no emails).
// The same error is emailed at most once every 15 minutes; nothing a user typed is included.
function alert_error(Throwable $e): void
{
    $to = trim((string) cfg('alert_email', ''));
    if ($to === '') {
        return;
    }
    try {
        $route = preg_replace('#/\d+#', '/:id', (string) ($GLOBALS['ROUTE'] ?? ''));
        $where = ($_SERVER['REQUEST_METHOD'] ?? '') . ' ' . $route;
        $mark = rl_dir() . '/alert-' . md5($e->getMessage() . '|' . $where) . '.mark';
        if (is_file($mark) && time() - filemtime($mark) < 900) {
            return;
        }
        @touch($mark);
        $lines = ['When: ' . gmdate('c'), 'Where: ' . trim($where), 'Company: ' . ($GLOBALS['COMPANY']['code'] ?? 'n/a'), 'Error: ' . $e->getMessage(), 'File: ' . basename($e->getFile()) . ':' . $e->getLine()];
        mail_send($to, 'WorkPilot error: ' . mb_substr($e->getMessage(), 0, 80), mail_html('WorkPilot', 'The site hit an error', array_map('mail_esc', $lines)));
    } catch (Throwable $ignored) {
        // an alert must never make the error worse
    }
}

function handle_error(Throwable $e): void
{
    if (headers_sent()) {
        return;
    }
    header_remove('Content-Disposition');
    if ($e instanceof HttpError) {
        $body = ['error' => $e->getMessage()];
        if ($e->details) {
            $body['details'] = $e->details;
        }
        respond($body, $e->status);
    }
    if ($e instanceof PDOException && (string) $e->getCode() === '23000') {
        $msg = $e->getMessage();
        if (stripos($msg, 'duplicate') !== false || stripos($msg, 'unique') !== false) {
            respond(['error' => 'Already exists'], 409);
        }
        respond(['error' => 'That record is linked to other data or refers to something that does not exist'], 400);
    }
    // A table the new version needs is not in the database yet: say exactly what to do instead of a vague 'Server error'.
    if ($e instanceof PDOException && (strpos($e->getMessage(), "doesn't exist") !== false || stripos($e->getMessage(), 'no such table') !== false)) {
        $msg = $e->getMessage();
        if (strpos($msg, 'companies') !== false || strpos($msg, 'platform_admins') !== false) {
            respond(['error' => 'The database has not been prepared for this version. In phpMyAdmin, select your database and import hr-live-upgrade-multicompany.sql (a site that already has data) or hr-live-install.sql (an empty database).'], 500);
        }
        respond(['error' => 'A database table is missing. Sign in at /platform and press "Update databases", or import the SQL file that came with this version.'] + (cfg('debug', false) ? ['detail' => $msg] : []), 500);
    }
    error_log('WorkPilot error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    alert_error($e);
    respond(['error' => 'Server error'] + (cfg('debug', false) ? ['detail' => $e->getMessage()] : []), 500);
}
set_exception_handler('handle_error');

function run_request(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('Cache-Control: no-store');

    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $at = strpos($path, '/api/v1');
    if ($at === false) {
        throw new HttpError(404, 'Not found');
    }
    $GLOBALS['API_BASE'] = substr($path, 0, $at); // the folder the site lives in, if any
    $route = rtrim(substr($path, $at + 7), '/') ?: '/';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        no_content();
    }
    backup_maybe_run(); // about once a day, after the answer has been sent
    att_reminders_maybe_run(); // every few minutes, after the answer has been sent
    // Slows down someone scraping data, or deleting records in bulk, with a stolen sign-in.
    rl_limit('api:' . client_ip(), 600, 60, 'Too many requests. Please slow down.');
    if ($method === 'DELETE') {
        rl_limit('del:' . client_ip(), 60, 60, 'Too many delete requests. Please slow down.');
    }

    $GLOBALS['ROUTE'] = $route;
    foreach (routes() as [$m, $pattern, $perms, $handler]) {
        if ($m !== $method) {
            continue;
        }
        $regex = '#^' . preg_replace('#:(\w+)#', '(?P<$1>[^/]+)', $pattern) . '$#';
        if (!preg_match($regex, $route, $mt)) {
            continue;
        }
        $params = array_filter($mt, 'is_string', ARRAY_FILTER_USE_KEY);
        if (strpos($route, '/platform') === 0) {
            tenant_none(); // the platform area never touches a company's own tables directly
        } elseif ($route !== '/health' && $route !== '/auth/logout') {
            tenant_resolve(); // which company is this request for?
            feature_gate($route); // parts of the product the company's plan does not include
        }
        if ($perms !== null) {
            authenticate();
            // Until a temporary password has been replaced, the only things allowed are: who am I, change the password, sign out.
            if (user()['mustChange'] && !in_array($route, ['/auth/me', '/auth/change-password', '/auth/logout'], true)) {
                http_response_code(403);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['error' => 'Please choose your own password first. Your administrator gave you a temporary one.', 'code' => 'PASSWORD_CHANGE_REQUIRED']);
                exit;
            }
            if (user()['mustSetup2fa'] && !in_array($route, ['/auth/me', '/auth/change-password', '/auth/logout', '/auth/2fa', '/auth/2fa/setup', '/auth/2fa/enable'], true)) {
                http_response_code(403);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode(['error' => 'Administrators must set up two-step sign-in before continuing.', 'code' => 'TWO_FACTOR_SETUP_REQUIRED']);
                exit;
            }
            if ($perms) {
                require_perm(...$perms);
            }
        }
        if (strpos($route, '/chat') === 0) {
            chat_touch();
        }
        $handler($params);
        return;
    }
    throw new HttpError(404, 'Not found: ' . $method . ' /api/v1' . $route);
}
