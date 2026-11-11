<?php
// "Download my company data" and automatic database backups.

const EXPORT_HIDE = ['users' => ['password_hash', 'totp_secret', 'recovery_codes', 'totp_last_step', 'failed_logins', 'locked_until', 'must_change_password']];

function backup_dir(): string
{
    $d = __DIR__ . '/../storage/backups';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

function csv_cell($v): string
{
    $s = $v === null ? '' : (string) $v;
    return preg_match('/[",\r\n]/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
}

// All of one company's data as a ZIP of CSV files (one per table) plus, optionally, its uploaded files. Run as that company.
function export_build(array $company, bool $withFiles): string
{
    $tmp = tempnam(sys_get_temp_dir(), 'wpx');
    $zip = new MiniZip($tmp);
    $tables = tenant_schema()['tables'];
    $counts = [];
    foreach ($tables as $t) {
        $hide = EXPORT_HIDE[$t] ?? [];
        $csv = tempnam(sys_get_temp_dir(), 'wpc');
        $out = fopen($csv, 'wb');
        fwrite($out, "\xEF\xBB\xBF"); // so Excel opens it as UTF-8
        $st = q_run('SELECT * FROM `' . $t . '`'); // switched to this company's table by tenant_sql()
        $head = false;
        $n = 0;
        while ($row = $st->fetch()) {
            $row = array_diff_key($row, array_flip($hide));
            if (!$head) {
                fwrite($out, implode(',', array_map('csv_cell', array_keys($row))) . "\r\n");
                $head = true;
            }
            fwrite($out, implode(',', array_map('csv_cell', array_values($row))) . "\r\n");
            $n++;
        }
        if (!$head) { // an empty table still gets its column names
            $st0 = q_run('SELECT * FROM `' . $t . '` LIMIT 0');
            $cols = [];
            for ($i = 0; $i < $st0->columnCount(); $i++) {
                $cols[] = $st0->getColumnMeta($i)['name'];
            }
            fwrite($out, implode(',', array_map('csv_cell', array_diff($cols, $hide))) . "\r\n");
        }
        fclose($out);
        $zip->addFile("data/$t.csv", $csv);
        unlink($csv);
        $counts[$t] = $n;
    }
    $skipped = '';
    if ($withFiles) {
        $root = uploads_root();
        $total = 0;
        $files = [];
        if (is_dir($root)) {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $f) {
                if ($f->isFile()) { $files[] = $f->getPathname(); $total += $f->getSize(); }
            }
        }
        if ($total > 300 * 1024 * 1024) {
            $skipped = "The uploaded files are larger than 300 MB, so they were left out. Ask your provider for a full copy.\r\n";
        } else {
            foreach ($files as $p) {
                $zip->addFile('files/' . ltrim(substr(str_replace('\\', '/', $p), strlen($root)), '/'), $p);
            }
        }
    }
    $readme = "WorkPilot data export\r\nCompany: {$company['name']} ({$company['code']})\r\nCreated: " . gmdate('Y-m-d H:i') . " UTC\r\n\r\n"
        . "data/   one CSV file per table (open in Excel). Passwords and security codes are never included.\r\n"
        . ($withFiles ? "files/  uploaded documents, photos, logo and chat files.\r\n" : "")
        . $skipped . "\r\nRows per table:\r\n";
    foreach ($counts as $t => $n) {
        $readme .= "  $t: $n\r\n";
    }
    $zip->add('README.txt', $readme);
    $zip->close();
    return $tmp;
}

function export_send(string $tmp, string $filename): void
{
    http_response_code(200);
    header('Content-Type: application/zip');
    header('Content-Length: ' . filesize($tmp));
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $filename) . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    readfile($tmp);
    unlink($tmp);
    exit;
}

// The company admin downloads their own company's data.
function export_company(): void
{
    require_admin();
    rl_limit('export:' . company()['id'], 6, 3600, 'You can download your data a few times an hour. Please try again later.');
    $withFiles = ($_GET['files'] ?? '') === '1';
    set_time_limit(300);
    audit('company', company()['id'], 'export', null, ['files' => $withFiles]);
    $tmp = export_build(company(), $withFiles);
    export_send($tmp, 'workpilot-' . company()['code'] . '-' . gmdate('Y-m-d') . ($withFiles ? '-with-files' : '') . '.zip');
}

// The platform owner exports one company (for example when a customer leaves).
function plat_export(array $p): void
{
    $adm = plat_require();
    $c = company_by_id((int) $p['id']);
    if (!$c) {
        throw new HttpError(404, 'Company not found');
    }
    plat_log($adm, 'company_export', $c, ($_GET['files'] ?? '') === '1' ? 'with uploaded files' : 'data only');
    set_time_limit(300);
    $tmp = tenant_with((string) $c['prefix'], fn() => export_build($c, ($_GET['files'] ?? '') === '1'));
    export_send($tmp, 'workpilot-' . $c['code'] . '-' . gmdate('Y-m-d') . '.zip');
}

// ---------- database backups ----------
function backup_value(PDO $pdo, $v): string
{
    if ($v === null) {
        return 'NULL';
    }
    if (is_int($v) || is_float($v)) {
        return (string) $v;
    }
    return $pdo->quote((string) $v);
}

// Writes the WHOLE database (every company and the platform tables) as a compressed SQL file. Returns the file name.
function backup_run(bool $withFiles = false): array
{
    if (cfg('db_driver', 'mysql') !== 'mysql') {
        throw new HttpError(400, 'Automatic backups need the MySQL database. For SQLite, copy the database file.');
    }
    set_time_limit(600);
    $pdo = db();
    $name = 'wp-db-' . gmdate('Y-m-d-His') . '.sql.gz';
    $path = backup_dir() . '/' . $name;
    $gz = gzopen($path, 'wb6');
    gzwrite($gz, "-- WorkPilot database backup, " . gmdate('c') . " UTC\n-- Restore: phpMyAdmin -> your (empty) database -> Import -> choose this file.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n");
    foreach ($pdo->query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"')->fetchAll(PDO::FETCH_NUM) as [$t]) {
        $create = $pdo->query('SHOW CREATE TABLE `' . $t . '`')->fetch(PDO::FETCH_NUM)[1];
        gzwrite($gz, "DROP TABLE IF EXISTS `$t`;\n$create;\n\n");
        $offset = 0;
        $batch = 500;
        do {
            $rows = $pdo->query("SELECT * FROM `$t` LIMIT $batch OFFSET $offset")->fetchAll(PDO::FETCH_NUM);
            if ($rows) {
                gzwrite($gz, "INSERT INTO `$t` VALUES " . implode(",\n", array_map(fn($r) => '(' . implode(',', array_map(fn($v) => backup_value($pdo, $v), $r)) . ')', $rows)) . ";\n");
            }
            $offset += $batch;
        } while (count($rows) === $batch);
        gzwrite($gz, "\n");
    }
    gzwrite($gz, "SET FOREIGN_KEY_CHECKS = 1;\n");
    gzclose($gz);
    $made = [['name' => $name, 'size' => filesize($path)]];
    if ($withFiles) {
        $root = uploads_root();
        $zname = 'wp-files-' . gmdate('Y-m-d-His') . '.zip';
        $zip = new MiniZip(backup_dir() . '/' . $zname);
        if (is_dir($root)) {
            foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
                if ($f->isFile()) { $zip->addFile(ltrim(substr(str_replace('\\', '/', $f->getPathname()), strlen($root)), '/'), $f->getPathname()); }
            }
        }
        $zip->close();
        $made[] = ['name' => $zname, 'size' => filesize(backup_dir() . '/' . $zname)];
    }
    backup_prune();
    return $made;
}

// Keep the newest 14 database backups and 4 file backups.
function backup_prune(): void
{
    foreach (['wp-db-*.sql.gz' => 14, 'wp-files-*.zip' => 4] as $pattern => $keep) {
        $list = glob(backup_dir() . '/' . $pattern) ?: [];
        rsort($list);
        foreach (array_slice($list, $keep) as $old) {
            @unlink($old);
        }
    }
}

// Runs a backup about once a day by itself, after the page has been sent, so no cPanel cron job is needed.
// (A cron job is better when you can set one: see the guide.) Switch off with 'backup' => ['auto' => false] in config.php.
function backup_maybe_run(): void
{
    $cfg = (array) cfg('backup', []);
    if (($cfg['auto'] ?? true) === false || cfg('db_driver', 'mysql') !== 'mysql') {
        return;
    }
    $mark = backup_dir() . '/.last';
    if (is_file($mark) && time() - filemtime($mark) < 23 * 3600) {
        return;
    }
    @touch($mark); // claim today's run first, so two visitors cannot start two backups
    register_shutdown_function(function () {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        try {
            backup_run(gmdate('w') === '0'); // files are included on Sundays
        } catch (Throwable $e) {
            error_log('WorkPilot backup failed: ' . $e->getMessage());
            @unlink(backup_dir() . '/.last'); // try again on the next visit
        }
    });
}

function backup_list(): array
{
    $out = [];
    foreach (glob(backup_dir() . '/wp-*') ?: [] as $f) {
        $out[] = ['name' => basename($f), 'size' => filesize($f), 'created_at' => gmdate('Y-m-d H:i:s', filemtime($f))];
    }
    usort($out, fn($a, $b) => strcmp($b['name'], $a['name']));
    return $out;
}

function plat_backups(): void
{
    plat_require();
    respond(backup_list());
}

function plat_backup_now(): void
{
    plat_require();
    rl_limit('backupnow', 6, 3600, 'Please wait a little before making another backup.');
    $made = backup_run(($_GET['files'] ?? '') === '1');
    @touch(backup_dir() . '/.last');
    respond(['made' => $made]);
}

function plat_backup_download(array $p): void
{
    plat_require();
    $name = (string) $p['name'];
    if (!preg_match('/^wp-(db|files)-[0-9-]+\.(sql\.gz|zip)$/', $name) || !is_file(backup_dir() . '/' . $name)) {
        throw new HttpError(404, 'Backup not found');
    }
    http_response_code(200);
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize(backup_dir() . '/' . $name));
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    readfile(backup_dir() . '/' . $name);
    exit;
}
