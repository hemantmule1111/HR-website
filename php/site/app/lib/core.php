<?php
// WorkPilot PHP backend: core helpers (configuration, database, requests, responses, validation).
// Runs on ordinary PHP + MySQL hosting (PHP 8.0 or newer). It answers the same /api/v1 requests as the Node version.

class HttpError extends Exception
{
    public int $status;
    public ?array $details;

    public function __construct(int $status, string $message, ?array $details = null)
    {
        parent::__construct($message);
        $this->status = $status;
        $this->details = $details;
    }
}

// ---------- configuration ----------
function cfg(string $key, $default = null)
{
    static $config = null;
    if ($config === null) {
        $file = __DIR__ . '/../config.php';
        if (!is_file($file)) {
            throw new HttpError(500, 'config.php is missing. Copy app/config.sample.php to app/config.php and fill in your database details.');
        }
        $config = require $file;
    }
    return array_key_exists($key, $config) ? $config[$key] : $default;
}

// ---------- database (PDO; MySQL in production, SQLite only for local tests) ----------
function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false];
    if (cfg('db_driver', 'mysql') === 'sqlite') {
        $pdo = new PDO('sqlite:' . cfg('db_file'), null, null, $opts);
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $dsn = 'mysql:host=' . cfg('db_host', 'localhost') . ';port=' . cfg('db_port', 3306) . ';dbname=' . cfg('db_name') . ';charset=utf8mb4';
        $opts[PDO::MYSQL_ATTR_INIT_COMMAND] = "SET time_zone = '+00:00', sql_mode = 'NO_ENGINE_SUBSTITUTION'";
        try {
            $pdo = new PDO($dsn, cfg('db_user'), cfg('db_password'), $opts);
        } catch (PDOException $e) {
            error_log('WorkPilot database connection failed: ' . $e->getMessage());
            throw new HttpError(500, 'Cannot connect to the database. Check db_name, db_user and db_password in app/config.php.' . (cfg('debug', false) ? ' (' . $e->getMessage() . ')' : ''));
        }
    }
    return $pdo;
}

function db_bind(PDOStatement $st, array $params): void
{
    $i = 1;
    foreach ($params as $p) {
        if (is_bool($p)) {
            $p = $p ? 1 : 0;
        }
        $type = is_int($p) ? PDO::PARAM_INT : (is_null($p) ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $st->bindValue($i++, $p, $type);
    }
}

// ---------- companies: every company has its own tables in the same database (a name prefix such as "c2_") ----------
// The first company keeps the plain, unprefixed tables. Controllers write ordinary SQL; the table names are switched here,
// so a query made for one company can only ever reach that company's tables.
$GLOBALS['TENANT'] = ['prefix' => '', 'none' => false];
function tenant_set(string $prefix): void { $GLOBALS['TENANT'] = ['prefix' => $prefix, 'none' => false]; }
function tenant_none(): void { $GLOBALS['TENANT'] = ['prefix' => '', 'none' => true]; }
function tenant_prefix(): string { return $GLOBALS['TENANT']['prefix']; }
function tenant_with(string $prefix, callable $fn)
{
    $old = $GLOBALS['TENANT'];
    tenant_set($prefix);
    try {
        return $fn();
    } finally {
        $GLOBALS['TENANT'] = $old;
    }
}
function tenant_schema(): array
{
    static $s = null;
    if ($s === null) {
        $f = __DIR__ . '/../schema/tenant-schema.json';
        $s = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
        $s += ['version' => 0, 'tables' => [], 'migrations' => [], 'seed' => []];
    }
    return $s;
}
// Rewrites the table names a company owns (FROM, JOIN, INTO, UPDATE ...) to that company's prefixed names.
function tenant_sql(string $sql): string
{
    $t = $GLOBALS['TENANT'];
    if (!$t['none'] && $t['prefix'] === '') {
        return $sql;
    }
    static $re = null;
    if ($re === null) {
        $names = tenant_schema()['tables'];
        if (!$names) {
            $re = false;
        } else {
            usort($names, fn($a, $b) => strlen($b) <=> strlen($a));
            $re = '/\b(DELETE\s+FROM|INSERT\s+INTO|REPLACE\s+INTO|UPDATE|FROM|JOIN|INTO)(\s+)(`?)(' . implode('|', array_map('preg_quote', $names)) . ')\3(?![\w`])(?=(\s+(?:AS\s+)?(\w+))?)/i';
        }
    }
    if ($re === false) {
        return $sql;
    }
    $notAlias = ['WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'UNION', 'SET', 'VALUES', 'USING', 'FOR', 'SELECT', 'AND', 'OR', 'NOT', 'IN', 'LOCK', 'FORCE', 'USE', 'NATURAL', 'STRAIGHT_JOIN'];
    return preg_replace_callback($re, function ($m) use ($t, $notAlias) {
        if ($t['none']) {
            throw new HttpError(500, 'No company selected for this request');
        }
        $kw = strtoupper(preg_replace('/\s+/', ' ', $m[1]));
        $q = $m[3];
        $alias = '';
        $has = !empty($m[5]) && !in_array(strtoupper($m[6] ?? ''), $notAlias, true);
        if (($kw === 'FROM' || $kw === 'JOIN') && !$has) {
            $alias = ' AS ' . $q . $m[4] . $q; // keep "table.column" references working
        }
        return $m[1] . $m[2] . $q . $t['prefix'] . $m[4] . $q . $alias;
    }, $sql);
}

function q_run(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare(tenant_sql($sql));
    db_bind($st, $params);
    $st->execute();
    return $st;
}
function q_all(string $sql, array $params = []): array { return q_run($sql, $params)->fetchAll(); }
function q_one(string $sql, array $params = []): ?array { $r = q_run($sql, $params)->fetch(); return $r === false ? null : $r; }
function q_val(string $sql, array $params = [])
{
    $r = q_run($sql, $params)->fetch(PDO::FETCH_NUM);
    return $r === false ? null : $r[0];
}
function q_col(string $sql, array $params = []): array { return q_run($sql, $params)->fetchAll(PDO::FETCH_COLUMN); }
function q_exec(string $sql, array $params = []): int { return q_run($sql, $params)->rowCount(); }

function q_insert(string $table, array $row): int
{
    $cols = array_keys($row);
    $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $cols) . '`) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')';
    q_run($sql, array_values($row));
    return (int) db()->lastInsertId();
}

function q_update(string $table, array $set, string $where, array $whereParams = []): int
{
    if (!$set) {
        return 0;
    }
    $parts = [];
    foreach (array_keys($set) as $c) {
        $parts[] = '`' . $c . '` = ?';
    }
    return q_exec('UPDATE `' . $table . '` SET ' . implode(', ', $parts) . ' WHERE ' . $where, array_merge(array_values($set), $whereParams));
}

function marks(array $values): string { return $values ? implode(',', array_fill(0, count($values), '?')) : 'NULL'; }

function in_transaction(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $r = $fn();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// ---------- request ----------
function req_headers(): array
{
    static $h = null;
    if ($h === null) {
        $h = [];
        foreach ($_SERVER as $k => $v) {
            if (strpos($k, 'HTTP_') === 0) {
                $h[strtolower(str_replace('_', '-', substr($k, 5)))] = $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $h['content-type'] = $_SERVER['CONTENT_TYPE'];
        }
        if (empty($h['authorization']) && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $h['authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
    }
    return $h;
}

function req_body(): array
{
    static $body = null;
    if ($body === null) {
        $ct = req_headers()['content-type'] ?? '';
        if (stripos($ct, 'application/json') !== false) {
            $raw = file_get_contents('php://input');
            $d = $raw === '' ? [] : json_decode($raw, true);
            if (!is_array($d)) {
                throw new HttpError(400, 'Invalid JSON');
            }
            $body = $d;
        } else {
            $body = $_POST;
        }
    }
    return $body;
}

function client_ip(): string
{
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') {
        return trim(explode(',', $xff)[0]);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

// ---------- responses ----------
function respond($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
function no_content(): void
{
    http_response_code(204);
    exit;
}

function send_csv(string $filename, array $rows, array $columns): void
{
    $esc = function ($v) {
        $s = $v === null ? '' : (string) $v;
        return preg_match('/[",\n]/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
    };
    $lines = [implode(',', array_map(fn($c) => $esc($c['label']), $columns))];
    foreach ($rows as $r) {
        $lines[] = implode(',', array_map(fn($c) => $esc($r[$c['key']] ?? null), $columns));
    }
    http_response_code(200);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    echo implode("\n", $lines);
    exit;
}

// ---------- validation (same messages and error shape as the Node version) ----------
class V
{
    public array $in;
    public array $errors = [];

    public function __construct(array $in) { $this->in = $in; }
    public function has(string $k): bool { return array_key_exists($k, $this->in); }
    private function fail(string $k, string $msg): void { $this->errors[] = ['code' => 'invalid', 'path' => [$k], 'message' => $msg]; }
    private function raw(string $k) { return $this->in[$k] ?? null; }
    private function blank($v): bool { return $v === null || $v === ''; }

    public function str(string $k, int $min = 1, int $max = 255): string
    {
        $v = $this->raw($k);
        if (!is_string($v) && !is_numeric($v)) { $this->fail($k, 'Required'); return ''; }
        $v = (string) $v;
        if (mb_strlen($v) < $min) { $this->fail($k, $min <= 1 ? 'Required' : "Must be at least $min characters"); }
        if (mb_strlen($v) > $max) { $this->fail($k, "Must be at most $max characters"); }
        return $v;
    }
    public function optStr(string $k, int $max = 255): ?string
    {
        $v = $this->raw($k);
        if ($this->blank($v)) { return null; }
        if (!is_string($v) && !is_numeric($v)) { $this->fail($k, 'Expected text'); return null; }
        $v = (string) $v;
        if (mb_strlen($v) > $max) { $this->fail($k, "Must be at most $max characters"); }
        return $v;
    }
    public function email(string $k, int $max = 150): string
    {
        $v = $this->str($k, 1, $max);
        if ($v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) { $this->fail($k, 'Invalid email'); }
        return $v;
    }
    public function int(string $k): int
    {
        $v = $this->raw($k);
        if ($this->blank($v) || !is_numeric($v) || (float) $v != (int) $v) { $this->fail($k, 'Expected a whole number'); return 0; }
        return (int) $v;
    }
    public function optInt(string $k): ?int
    {
        $v = $this->raw($k);
        if ($this->blank($v)) { return null; }
        if (!is_numeric($v) || (float) $v != (int) $v) { $this->fail($k, 'Expected a whole number'); return null; }
        return (int) $v;
    }
    public function num(string $k, ?float $min = null, ?float $max = null): float
    {
        $v = $this->raw($k);
        if ($this->blank($v) || !is_numeric($v)) { $this->fail($k, 'Expected a number'); return 0.0; }
        $n = (float) $v;
        if ($min !== null && $n < $min) { $this->fail($k, "Must be at least $min"); }
        if ($max !== null && $n > $max) { $this->fail($k, "Must be at most $max"); }
        return $n;
    }
    public function optNum(string $k, ?float $min = null, ?float $max = null): ?float
    {
        return $this->blank($this->raw($k)) ? null : $this->num($k, $min, $max);
    }
    public function bool(string $k): ?bool
    {
        $v = $this->raw($k);
        if ($v === null) { return null; }
        if (is_bool($v)) { return $v; }
        if (in_array($v, [1, 0, '1', '0', 'true', 'false'], true)) { return $v === 1 || $v === '1' || $v === 'true'; }
        $this->fail($k, 'Expected true or false');
        return null;
    }
    public function enum(string $k, array $allowed, ?string $default = null): ?string
    {
        $v = $this->raw($k);
        if ($this->blank($v)) {
            if ($default !== null) { return $default; }
            $this->fail($k, 'Required');
            return null;
        }
        if (!in_array($v, $allowed, true)) { $this->fail($k, 'Invalid option'); return null; }
        return $v;
    }
    public function optEnum(string $k, array $allowed): ?string
    {
        $v = $this->raw($k);
        if ($this->blank($v)) { return null; }
        if (!in_array($v, $allowed, true)) { $this->fail($k, 'Invalid option'); return null; }
        return $v;
    }
    public function date(string $k): string
    {
        $v = $this->raw($k);
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) { $this->fail($k, 'Use YYYY-MM-DD'); return ''; }
        return $v;
    }
    public function optDate(string $k): ?string
    {
        return $this->blank($this->raw($k)) ? null : $this->date($k);
    }
    public function month(string $k): string
    {
        $v = $this->raw($k);
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}$/', $v)) { $this->fail($k, 'Use YYYY-MM'); return ''; }
        return $v;
    }
    public function time(string $k): string
    {
        $v = $this->raw($k);
        if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) { $this->fail($k, 'Use HH:MM'); return ''; }
        return $v;
    }
    public function regex(string $k, string $pattern, string $msg = 'Invalid format'): string
    {
        $v = $this->raw($k);
        if (!is_string($v) || !preg_match($pattern, $v)) { $this->fail($k, $msg); return ''; }
        return (string) $v;
    }
    public function done(): void
    {
        if ($this->errors) {
            throw new HttpError(400, 'Validation failed', $this->errors);
        }
    }
}

// ---------- small utilities ----------
function random_token(int $bytes = 6): string
{
    return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}
function uuid4(): string
{
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
function b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64url_dec(string $s): string { return base64_decode(strtr($s, '-_', '+/')); }

function num_or_null($v) { return $v === null ? null : $v + 0; }
function cast_fields(array $row, array $fields): array
{
    foreach ($fields as $f) {
        if (array_key_exists($f, $row) && $row[$f] !== null && is_numeric($row[$f])) {
            $row[$f] = $row[$f] + 0;
        }
    }
    return $row;
}
function cast_rows(array $rows, array $fields): array
{
    return array_map(fn($r) => cast_fields($r, $fields), $rows);
}

function uploads_root(): string
{
    $dir = (cfg('upload_dir') ?: (__DIR__ . '/../storage/uploads')) . (tenant_prefix() !== '' ? '/' . rtrim(tenant_prefix(), '_') : ''); // each company keeps its files in its own folder
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return rtrim(str_replace('\\', '/', realpath($dir) ?: $dir), '/');
}
