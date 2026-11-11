<?php
// Security helpers: upload inspection, safe file serving, rate limiting and password strength.
// Mirrors server/src/utils/fileGuard.js.

const UPLOAD_MIME = [
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp', 'pdf' => 'application/pdf',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt' => 'text/plain; charset=utf-8', 'csv' => 'text/csv; charset=utf-8',
];
const UPLOAD_LABEL = ['png' => 'PNG', 'jpg' => 'JPG', 'gif' => 'GIF', 'webp' => 'WebP', 'pdf' => 'PDF', 'docx' => 'Word (.docx)', 'xlsx' => 'Excel (.xlsx)', 'pptx' => 'PowerPoint (.pptx)', 'txt' => 'text (.txt)', 'csv' => 'CSV'];
const UPLOAD_IMAGE_EXT = ['png', 'jpg', 'gif', 'webp'];

function upload_detect(string $buf, string $ext): ?string
{
    $h = substr($buf, 0, 12);
    if (strncmp($h, "\x89PNG\r\n\x1a\n", 8) === 0) { return 'png'; }
    if (strncmp($h, "\xff\xd8\xff", 3) === 0) { return 'jpg'; }
    if (strncmp($h, 'GIF87a', 6) === 0 || strncmp($h, 'GIF89a', 6) === 0) { return 'gif'; }
    if (strncmp($h, 'RIFF', 4) === 0 && substr($h, 8, 4) === 'WEBP') { return 'webp'; }
    if (strncmp($h, '%PDF-', 5) === 0) { return 'pdf'; }
    if (strncmp($h, "PK\x03\x04", 4) === 0) {
        if (strpos($buf, '[Content_Types].xml') === false) { return null; }
        if (strpos($buf, 'word/') !== false) { return 'docx'; }
        if (strpos($buf, 'xl/') !== false) { return 'xlsx'; }
        if (strpos($buf, 'ppt/') !== false) { return 'pptx'; }
        return null;
    }
    if ($ext === 'txt' || $ext === 'csv') { // plain text: no binary bytes and valid UTF-8
        if (preg_match('/[\x00-\x08\x0e-\x1a\x1c-\x1f]/', $buf)) { return null; }
        if (!mb_check_encoding($buf, 'UTF-8')) { return null; }
        return $ext;
    }
    return null;
}

// Checks an uploaded file by its real content. Returns ['ext' => , 'mime' => ] or throws a friendly error.
function upload_inspect(string $path, string $originalName, array $allowed): array
{
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $ext = $ext === 'jpeg' ? 'jpg' : $ext;
    $buf = (string) file_get_contents($path);
    $kind = upload_detect($buf, $ext);
    if (!$kind || !in_array($kind, $allowed, true)) {
        throw new HttpError(400, 'This file is not allowed. Only these documents can be uploaded: ' . implode(', ', array_map(fn($k) => UPLOAD_LABEL[$k], $allowed)) . '.');
    }
    if (in_array($kind, ['docx', 'xlsx', 'pptx'], true)) {
        if (preg_match('/vbaProject|activeX|\/embeddings\/|\.(exe|dll|com|scr|bat|cmd|ps1|vbs|js|jse|wsf|hta|jar|lnk|php|phtml|html?|sh)\b/i', $buf)) {
            throw new HttpError(400, 'This Office file contains a macro, program or embedded object, so it was refused. Save a plain copy without macros and try again.');
        }
    } else {
        if (preg_match('/<\?php|<\?=|<script|<%@|<%=|<iframe|<object|<embed|<svg|<!doctype html|<html/i', $buf)) {
            throw new HttpError(400, 'This file contains script or program code, so it was refused.');
        }
        if ($kind === 'pdf' && preg_match('/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z0-9])/', $buf)) {
            throw new HttpError(400, 'This PDF contains scripts or attachments, so it was refused. Print it to a new PDF and try again.');
        }
    }
    return ['ext' => $kind, 'mime' => explode(';', UPLOAD_MIME[$kind])[0]];
}

// ---------- rate limiting (a small file per key, so it works on any shared host) ----------
function rl_dir(): string
{
    $d = __DIR__ . '/../storage/ratelimit';
    if (!is_dir($d)) {
        @mkdir($d, 0775, true);
    }
    return $d;
}

// Counts one hit for $key inside a window of $window seconds; returns the count so far.
function rl_hit(string $key, int $window): int
{
    if (!cfg('rate_limit', true)) {
        return 0;
    }
    $f = rl_dir() . '/' . sha1($key) . '.json';
    $fh = @fopen($f, 'c+');
    if (!$fh) {
        return 0; // cannot write: never block real users because of a hosting problem
    }
    flock($fh, LOCK_EX);
    $d = json_decode((string) stream_get_contents($fh), true);
    $now = time();
    if (!is_array($d) || ($d['reset'] ?? 0) < $now) {
        $d = ['n' => 0, 'reset' => $now + $window];
    }
    $d['n']++;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($d));
    flock($fh, LOCK_UN);
    fclose($fh);
    if (random_int(1, 200) === 1) { // tidy up old counters now and then
        foreach (glob(rl_dir() . '/*.json') ?: [] as $old) {
            if (filemtime($old) < $now - 86400) { @unlink($old); }
        }
    }
    return $d['n'];
}
function rl_count(string $key): int
{
    if (!cfg('rate_limit', true)) {
        return 0;
    }
    $f = rl_dir() . '/' . sha1($key) . '.json';
    $d = is_file($f) ? json_decode((string) @file_get_contents($f), true) : null;
    return is_array($d) && ($d['reset'] ?? 0) >= time() ? (int) $d['n'] : 0;
}
function rl_limit(string $key, int $max, int $window, string $message): void
{
    if (rl_hit($key, $window) > $max) {
        header('Retry-After: ' . $window);
        throw new HttpError(429, $message);
    }
}

// ---------- passwords ----------
function password_weak(string $pw, ?string $email = null): ?string
{
    $l = strtolower($pw);
    $common = ['password', 'passw0rd', '1234567890', '0123456789', 'qwertyuiop', 'qwerty1234', 'letmein123', 'welcome123', 'admin12345', 'changeme123', 'iloveyou12', 'abcdefghij', 'workpilot'];
    foreach ($common as $c) {
        if (strpos($l, $c) !== false) { return 'That password is too easy to guess. Choose something less common.'; }
    }
    if (count(array_unique(str_split($pw))) < 5) { return 'That password is too repetitive. Use a mix of letters, numbers and symbols.'; }
    if ($email && strpos($l, strtolower(explode('@', $email)[0])) !== false && strlen(explode('@', $email)[0]) >= 4) { return 'Your password should not contain your email name.'; }
    return null;
}
function password_require_strong(string $pw, ?string $email = null): void
{
    $w = password_weak($pw, $email);
    if ($w) {
        throw new HttpError(400, $w);
    }
}
