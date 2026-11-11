<?php
// Daily backup from a cPanel cron job (more reliable than the automatic one, because it does not wait for a visitor):
//   cPanel -> Cron Jobs -> once a day, command:   /usr/local/bin/php /home/YOURACCOUNT/public_html/hr/app/cron-backup.php
// Backups are saved in app/storage/backups (the platform owner can download them at /platform -> Backups).
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('This file can only be run from a cron job.');
}
$_SERVER['REQUEST_METHOD'] = 'CLI';
$_SERVER['HTTP_HOST'] = 'localhost';
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/services.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/zip.php';
require __DIR__ . '/controllers/backup.php';
try {
    $made = backup_run(gmdate('w') === '0');
    @touch(backup_dir() . '/.last');
    foreach ($made as $m) {
        echo 'Saved ' . $m['name'] . ' (' . round($m['size'] / 1024) . " KB)\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Backup failed: ' . $e->getMessage() . "\n");
    exit(1);
}
