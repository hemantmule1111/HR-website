<?php
// WorkPilot setup check. Open this page once after uploading to see whether the server is ready, then DELETE this file.
ini_set('display_errors', '0');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

$rows = [];
$add = function (string $name, bool $ok, string $detail, bool $required = true) use (&$rows) {
    $rows[] = [$name, $ok ? 'ok' : ($required ? 'fail' : 'warn'), $detail];
};

$add('PHP version', version_compare(PHP_VERSION, '7.4.0', '>='), PHP_VERSION . ' (7.4 or newer is needed; 8.1 or newer is best)');
foreach (['pdo_mysql' => true, 'mbstring' => true, 'json' => true, 'fileinfo' => false] as $ext => $required) {
    $add("PHP extension: $ext", extension_loaded($ext), extension_loaded($ext) ? 'enabled' : ($required ? 'missing: enable it in cPanel, Select PHP Version, Extensions' : 'missing: uploads will still work'), $required);
}

$base = __DIR__;

// This page shows details about the server, so once anyone has signed in (setup is finished) it switches itself off.
// Delete this file after the first check anyway.
if (is_file($base . '/app/config.php')) {
    try {
        require_once $base . '/app/lib/core.php';
        if ((int) db()->query('SELECT COUNT(*) FROM users WHERE last_login_at IS NOT NULL')->fetchColumn() > 0) {
            http_response_code(403);
            exit('Setup is finished. Please delete check.php from the server.');
        }
    } catch (Throwable $e) {
        // not installed yet: carry on with the check
    }
}
$config = is_file($base . '/app/config.php');
$add('app/config.php exists', $config, $config ? 'found' : 'missing: the file app/config.php was not uploaded');

if ($config) {
    require_once $base . '/app/lib/core.php';
    $secret = (string) cfg('jwt_secret', '');
    $add('jwt_secret is set', strlen($secret) >= 20 && strpos($secret, 'PUT_') !== 0, 'a long random value is needed in app/config.php');
    try {
        $pdo = db();
        $add('Database connection', true, 'connected');
        foreach (['users' => 'Main tables', 'company_profile' => 'Company profile table', 'chat_messages' => 'Chat tables', 'companies' => 'Companies table (multi-company)', 'platform_admins' => 'Platform owner table'] as $t => $label) {
            try {
                $n = $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
                $add($label, true, "found ($t has $n rows)");
            } catch (Throwable $e) {
                $add($label, false, "table $t is missing: import hr-live-install.sql (empty database) or hr-live-upgrade-multicompany.sql (site that already has data) in phpMyAdmin");
            }
        }
        try {
            $admins = $pdo->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Super Admin'")->fetchColumn();
            $add('A Super Admin account exists', (int) $admins > 0, (int) $admins . ' found');
        } catch (Throwable $e) {
        }
    } catch (Throwable $e) {
        $add('Database connection', false, $e instanceof HttpError ? $e->getMessage() : 'failed');
    }
    $store = $base . '/app/storage';
    if (!is_dir($store . '/uploads')) {
        @mkdir($store . '/uploads', 0775, true);
    }
    $add('Uploads folder is writable', is_dir($store . '/uploads') && is_writable($store . '/uploads'), 'app/storage/uploads (documents, logo and chat files are saved here)');
}

// Do the web app files in this folder belong to this web address?
$siteBase = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/check.php')), '/') . '/'; // "/" or "/hr/"
$indexFile = $base . '/index.html';
if (!is_file($indexFile)) {
    $add('Web app (index.html)', false, 'index.html is missing from this folder: extract the website zip here');
} else {
    $html = (string) file_get_contents($indexFile);
    if (preg_match('#<script[^>]*type="module"[^>]*src="([^"]+)"#', $html, $mm)) {
        $src = $mm[1];
        $builtFor = preg_replace('#assets/[^/]*$#', '', $src); // the folder the web app was built for, e.g. "/" or "/hr/"
        if ($builtFor !== $siteBase) {
            $add('Web app matches this address', false, "WRONG PACKAGE: this web app was built for \"$builtFor\" but this site is at \"$siteBase\". Upload the website zip that was made for THIS address (its file name says which), extract it here (overwrite everything), then clear the host's cache.");
        } elseif (!is_file($base . '/' . substr($src, strlen($siteBase)))) {
            $add('Web app matches this address', false, "index.html asks for \"$src\" but that file is not in this folder. Extract the website zip again (overwrite).");
        } else {
            $add('Web app matches this address', true, "index.html loads \"$src\" and the file is there");
        }
    }
}
$add('.htaccess is present', is_file($base . '/.htaccess'), is_file($base . '/.htaccess') ? 'found (it is a hidden file)' : 'missing: extract the zip again; turn on "Show Hidden Files" in File Manager to see it');

// Does the API answer at this address (this tests the .htaccess rewrite rules)?
$apiUrl = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $siteBase . 'api/v1/health';
$body = null;
if (function_exists('curl_init')) {
    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    curl_close($ch);
} elseif (ini_get('allow_url_fopen')) {
    $body = @file_get_contents($apiUrl, false, stream_context_create(['http' => ['timeout' => 6]]));
}
if ($body === null || $body === false) {
    $add('API answers at ' . $siteBase . 'api/v1/health', false, 'could not test from the server itself (this alone is not a problem). Open ' . $siteBase . 'api/v1/health in your browser: it should show {"ok":true}', false);
} else {
    $good = strpos((string) $body, '"ok":true') !== false;
    $add('API answers at ' . $siteBase . 'api/v1/health', $good, $good ? 'answers {"ok":true}' : 'got something else: the .htaccess rewrite rules are not active on this host. Ask your host to enable mod_rewrite / .htaccess for this site');
}

$mb = function ($v) { return (float) $v * (stripos($v, 'g') !== false ? 1024 : (stripos($v, 'k') !== false ? 1 / 1024 : 1)); };
$add('Upload size limit', $mb(ini_get('upload_max_filesize')) >= 10, 'upload_max_filesize = ' . ini_get('upload_max_filesize') . ' (10M or more is needed for chat files)', false);
$add('Post size limit', $mb(ini_get('post_max_size')) >= 10, 'post_max_size = ' . ini_get('post_max_size'), false);
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$add('Page is opened over https', $https, $https ? 'secure' : 'open this page with https:// (turn on SSL for this address first)', false);

$bad = count(array_filter($rows, fn($r) => $r[1] === 'fail'));
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WorkPilot setup check</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f7fb;color:#16202e;margin:0;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{font-size:1.5rem;margin:0 0 .3rem}p{color:#586a80}
.box{background:#fff;border:1px solid #dce4ee;border-radius:14px;overflow:hidden;margin:1rem 0}
.row{display:flex;gap:.8rem;padding:.7rem 1rem;border-bottom:1px solid #eef2f7;align-items:flex-start}.row:last-child{border:0}
.pill{flex:none;min-width:3.4rem;text-align:center;font-weight:700;font-size:.75rem;border-radius:99px;padding:.15rem .6rem}
.ok{background:#e3f6ec;color:#0a7a45}.fail{background:#fde8e8;color:#b42318}.warn{background:#fdf3e2;color:#a35a06}
.name{font-weight:600}.detail{color:#586a80;font-size:.9rem}
.banner{padding:1rem;border-radius:12px;font-weight:600}.good{background:#e3f6ec;color:#0a7a45}.badb{background:#fde8e8;color:#b42318}
</style></head><body><main>
<h1>WorkPilot setup check</h1>
<p>Open this page after uploading, fix anything marked FAIL, then <b>delete check.php</b> from the server.</p>
<div class="banner <?= $bad ? 'badb' : 'good' ?>"><?= $bad ? $bad . ' problem(s) to fix before the site can work.' : 'Everything needed is in place. Open the site and sign in, then delete this file (check.php).' ?></div>
<div class="box"><?php foreach ($rows as $r) : ?>
<div class="row"><span class="pill <?= $h($r[1]) ?>"><?= strtoupper($h($r[1])) ?></span><div><div class="name"><?= $h($r[0]) ?></div><div class="detail"><?= $h($r[2]) ?></div></div></div>
<?php endforeach; ?></div>
</main></body></html>
