<?php
// Two-step sign-in with an authenticator app (RFC 6238 time-based codes) plus one-time recovery codes.
// Mirrors server/src/utils/totp.js.

const TOTP_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp_base32(string $bin): string
{
    $bits = '';
    foreach (str_split($bin) as $c) {
        $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= TOTP_B32[bindec(str_pad($chunk, 5, '0'))];
    }
    return $out;
}
function totp_unbase32(string $s): string
{
    $bits = '';
    foreach (str_split(strtoupper(rtrim($s, '='))) as $c) {
        $bits .= str_pad(decbin((int) strpos(TOTP_B32, $c)), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) === 8) {
            $out .= chr(bindec($byte));
        }
    }
    return $out;
}

function totp_new_secret(): string { return totp_base32(random_bytes(20)); }

function totp_hotp(string $secret, int $counter): string
{
    $h = hash_hmac('sha1', pack('J', $counter), totp_unbase32($secret), true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}

// Returns the time step the code belongs to, or null. A step that was already used ($lastStep) is refused, so a code works once.
function totp_verify(string $secret, string $code, int $lastStep = 0): ?int
{
    $c = preg_replace('/\s+/', '', $code);
    if (!preg_match('/^\d{6}$/', $c)) {
        return null;
    }
    $now = intdiv(time(), 30);
    foreach ([0, -1, 1] as $w) { // one step either side, for clocks that are a little off
        $step = $now + $w;
        if ($step > $lastStep && hash_equals(totp_hotp($secret, $step), $c)) {
            return $step;
        }
    }
    return null;
}

function totp_otpauth(string $issuer, string $account, string $secret): string
{
    return 'otpauth://totp/' . rawurlencode("$issuer:$account") . "?secret=$secret&issuer=" . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30';
}

// ---- recovery codes: shown once, stored only as hashes, each works once ----
function totp_norm(string $c): string { return preg_replace('/[^a-z0-9]/', '', strtolower($c)); }
function totp_hash(string $c): string { return hash('sha256', totp_norm($c)); }
function totp_new_recovery_codes(int $n = 8): array
{
    $codes = [];
    for ($i = 0; $i < $n; $i++) {
        $r = strtolower(substr(totp_base32(random_bytes(5)), 0, 8));
        $codes[] = substr($r, 0, 4) . '-' . substr($r, 4);
    }
    return ['codes' => $codes, 'hashes' => array_map('totp_hash', $codes)];
}
// Returns the remaining hashes if the code was valid, otherwise null.
function totp_use_recovery(?string $stored, string $code): ?array
{
    $list = json_decode((string) $stored, true) ?: [];
    $h = totp_hash($code);
    return in_array($h, $list, true) ? array_values(array_diff($list, [$h])) : null;
}

// ---- protecting the secret inside the database (AES-256-GCM, key derived from the site's jwt_secret) ----
function totp_key(): string { return hash('sha256', 'wp-data-key:' . jwt_secret(), true); }
function totp_encrypt(string $text): string
{
    $iv = random_bytes(12);
    $ct = openssl_encrypt($text, 'aes-256-gcm', totp_key(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ct === false) {
        throw new HttpError(500, 'The server cannot encrypt data (the PHP openssl extension is missing).');
    }
    return 'v1:' . base64_encode($iv . $tag . $ct);
}
function totp_decrypt(?string $stored): string
{
    if (!$stored || strpos($stored, 'v1:') !== 0) {
        return (string) $stored;
    }
    $raw = base64_decode(substr($stored, 3));
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', totp_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    if ($pt === false) {
        throw new HttpError(500, 'Could not read the two-step secret. Was jwt_secret changed?');
    }
    return $pt;
}
