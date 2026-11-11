<?php
// Local test helper: PHP's built-in web server ignores .htaccess, so this does what the .htaccess does on a real host.
// Start it from the folder that holds the website files:  php -S localhost:8300 router.php
// For a site in a sub-folder (https://example.com/hr/), put the files in <docroot>/hr and set SITE_PREFIX=/hr.
$prefix = getenv('SITE_PREFIX') ?: '';
$root = __DIR__;
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if ($prefix !== '' && $path !== $prefix && strpos($path, $prefix . '/') !== 0) {
    http_response_code(404);
    echo 'Not found';
    return true;
}
$rel = $prefix !== '' ? (substr($path, strlen($prefix)) ?: '/') : $path;
$site = $root . $prefix;

if (preg_match('#^/api/v1(/|$)#', $rel)) {
    require $site . '/api/index.php';
    return true;
}
if (preg_match('#^/(app|database)(/|$)#', $rel)) {
    http_response_code(403);
    echo 'Forbidden';
    return true;
}
$file = $site . $rel;
if ($rel !== '/' && is_file($file)) {
    if (substr($file, -4) === '.php') {
        require $file;
        return true;
    }
    $types = ['js' => 'text/javascript', 'css' => 'text/css', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'svg' => 'image/svg+xml', 'html' => 'text/html', 'json' => 'application/json', 'ico' => 'image/x-icon'];
    header('Content-Type: ' . ($types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
    readfile($file);
    return true;
}
$dir = rtrim($rel, '/');
if ($dir !== '' && is_file($site . $dir . '/index.html')) {
    readfile($site . $dir . '/index.html');
    return true;
}
readfile($site . '/index.html');
return true;
