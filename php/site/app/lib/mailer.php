<?php
// Sending email. No extra software is needed: it talks to your mail server (SMTP) directly, or uses the host's own mail() function.
//
// app/config.php (all optional):
//   'mail' => [
//       'transport' => 'smtp',            // smtp | php | log   (php = the host's mail(); log = write to app/storage/mail.log instead of sending)
//       'host' => 'mail.yourdomain.com', 'port' => 587, 'secure' => 'tls',   // tls (587) | ssl (465) | '' (25)
//       'user' => 'noreply@yourdomain.com', 'pass' => '...',
//       'from' => 'noreply@yourdomain.com', 'from_name' => 'WorkPilot',
//   ],
//   'app_url' => 'https://hr.wpart.co.in/',   // used for links in emails (worked out from the request when empty)
// With no 'mail' setting the host's mail() function is used, which works on most cPanel hosts.

function mail_config(): array
{
    $m = (array) cfg('mail', []);
    $host = parse_url((string) (cfg('app_url') ?: (($_SERVER['HTTP_HOST'] ?? 'localhost'))), PHP_URL_HOST) ?: preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    return $m + [
        'transport' => 'php', 'host' => '', 'port' => 587, 'secure' => 'tls', 'user' => '', 'pass' => '',
        'from' => 'noreply@' . $host, 'from_name' => 'WorkPilot',
    ];
}

// The address people open from an email link, ending with a slash.
function app_url(): string
{
    $u = (string) cfg('app_url', '');
    if ($u !== '') {
        return rtrim($u, '/') . '/';
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ($GLOBALS['API_BASE'] ?? '') . '/';
}

function mail_clean(string $s): string { return trim(str_replace(["\r", "\n", "\0"], ' ', $s)); } // no header injection

function mail_build(string $to, string $subject, string $html, string $text, array $c): string
{
    $boundary = 'wp_' . bin2hex(random_bytes(8));
    $from = '=?UTF-8?B?' . base64_encode(mail_clean($c['from_name'])) . '?= <' . mail_clean($c['from']) . '>';
    $h = [
        'Date: ' . date('r'), 'From: ' . $from, 'To: ' . mail_clean($to), 'Subject: =?UTF-8?B?' . base64_encode(mail_clean($subject)) . '?=',
        'MIME-Version: 1.0', 'Message-ID: <' . bin2hex(random_bytes(10)) . '@' . substr(strrchr($c['from'], '@'), 1) . '>', 'X-Auto-Response-Suppress: All',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];
    $body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) .
        "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$boundary--\r\n";
    return implode("\r\n", $h) . "\r\n\r\n" . $body;
}

function smtp_expect($fp, array $ok): string
{
    $line = '';
    do {
        $row = fgets($fp, 1024);
        if ($row === false) { throw new RuntimeException('The mail server closed the connection'); }
        $line = $row;
    } while (isset($row[3]) && $row[3] === '-'); // multi-line reply
    if (!in_array((int) substr($line, 0, 3), $ok, true)) {
        throw new RuntimeException('Mail server said: ' . trim($line));
    }
    return $line;
}
function smtp_cmd($fp, string $cmd, array $ok): string
{
    fwrite($fp, $cmd . "\r\n");
    return smtp_expect($fp, $ok);
}

function mail_smtp(string $to, string $message, array $c): void
{
    $scheme = $c['secure'] === 'ssl' ? 'ssl://' : '';
    $fp = @stream_socket_client($scheme . $c['host'] . ':' . (int) $c['port'], $errno, $errstr, 10);
    if (!$fp) {
        throw new RuntimeException("Cannot reach the mail server {$c['host']}:{$c['port']} ($errstr)");
    }
    stream_set_timeout($fp, 15);
    try {
        smtp_expect($fp, [220]);
        $name = preg_replace('/[^a-z0-9.-]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost')) ?: 'localhost';
        smtp_cmd($fp, 'EHLO ' . $name, [250]);
        if ($c['secure'] === 'tls') {
            smtp_cmd($fp, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('Could not start a secure (TLS) connection to the mail server');
            }
            smtp_cmd($fp, 'EHLO ' . $name, [250]);
        }
        if ($c['user'] !== '') {
            smtp_cmd($fp, 'AUTH LOGIN', [334]);
            smtp_cmd($fp, base64_encode($c['user']), [334]);
            smtp_cmd($fp, base64_encode($c['pass']), [235]);
        }
        smtp_cmd($fp, 'MAIL FROM:<' . mail_clean($c['from']) . '>', [250]);
        smtp_cmd($fp, 'RCPT TO:<' . mail_clean($to) . '>', [250, 251]);
        smtp_cmd($fp, 'DATA', [354]);
        $data = preg_replace('/^\./m', '..', str_replace("\r\n", "\n", $message));
        fwrite($fp, str_replace("\n", "\r\n", $data) . "\r\n.\r\n");
        smtp_expect($fp, [250]);
        @smtp_cmd($fp, 'QUIT', [221]);
    } finally {
        fclose($fp);
    }
}

// Sends one email now. Returns ['sent' => bool, 'transport' => string, 'error' => ?string]; never throws.
function mail_send(string $to, string $subject, string $html, string $text = ''): array
{
    $c = mail_config();
    $to = mail_clean($to);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['sent' => false, 'transport' => $c['transport'], 'error' => 'Not a valid email address'];
    }
    if ($text === '') {
        $text = trim(html_entity_decode(strip_tags(preg_replace('/<(br|\/p|\/h\d|\/tr)>/i', "\n", $html)), ENT_QUOTES, 'UTF-8'));
    }
    try {
        if ($c['transport'] === 'log') {
            $dir = __DIR__ . '/../storage';
            @file_put_contents($dir . '/mail.log', json_encode(['time' => gmdate('c'), 'to' => $to, 'subject' => $subject, 'text' => $text, 'html' => $html], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        } elseif ($c['transport'] === 'smtp' && $c['host'] !== '') {
            mail_smtp($to, mail_build($to, $subject, $html, $text, $c), $c);
        } else {
            $msg = mail_build($to, $subject, $html, $text, $c);
            [$head, $body] = explode("\r\n\r\n", $msg, 2);
            $head = preg_replace('/^(To|Subject): .*\r\n/m', '', $head . "\r\n");
            $ok = @mail($to, '=?UTF-8?B?' . base64_encode(mail_clean($subject)) . '?=', $body, rtrim($head), '-f' . mail_clean($c['from']));
            if (!$ok) {
                throw new RuntimeException('The host refused to send mail with mail(). Set up SMTP in app/config.php.');
            }
        }
        return ['sent' => true, 'transport' => $c['transport'], 'error' => null];
    } catch (Throwable $e) {
        error_log('WorkPilot mail failed (' . $to . '): ' . $e->getMessage());
        return ['sent' => false, 'transport' => $c['transport'], 'error' => $e->getMessage()];
    }
}

// Emails are queued and sent AFTER the answer has gone back to the browser, so a slow mail server never slows the site.
$GLOBALS['MAIL_QUEUE'] = [];
function mail_queue(string $to, string $subject, string $html): void
{
    if (!$GLOBALS['MAIL_QUEUE']) {
        register_shutdown_function(function () {
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            }
            foreach ($GLOBALS['MAIL_QUEUE'] as [$to, $subject, $html]) {
                mail_send($to, $subject, $html);
            }
            $GLOBALS['MAIL_QUEUE'] = [];
        });
    }
    $GLOBALS['MAIL_QUEUE'][] = [$to, $subject, $html];
}

function mail_esc(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

// A plain, mobile-friendly email body. $lines are paragraphs (already plain text); $facts is a list of [label, value] shown in a box.
function mail_html(string $company, string $heading, array $lines, ?string $button = null, ?string $url = null, array $facts = [], string $foot = ''): string
{
    $p = '';
    foreach ($lines as $l) {
        $p .= '<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">' . mail_esc($l) . '</p>';
    }
    $f = '';
    if ($facts) {
        $f = '<table role="presentation" style="width:100%;margin:6px 0 18px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;border-spacing:0">';
        foreach ($facts as [$k, $v]) {
            $f .= '<tr><td style="padding:9px 14px;font-size:13px;color:#64748b;width:38%">' . mail_esc($k) . '</td><td style="padding:9px 14px;font-size:15px;color:#0f172a;font-weight:600;word-break:break-all">' . mail_esc($v) . '</td></tr>';
        }
        $f .= '</table>';
    }
    $b = $button && $url ? '<p style="margin:18px 0"><a href="' . mail_esc($url) . '" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">' . mail_esc($button) . '</a></p><p style="margin:0 0 14px;font-size:12px;color:#94a3b8;word-break:break-all">If the button does not work, copy this address into your browser:<br>' . mail_esc($url) . '</p>' : '';
    return '<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;background:#f4f5fb;padding:24px 12px"><tr><td align="center">'
        . '<table role="presentation" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;padding:28px"><tr><td>'
        . '<p style="margin:0 0 4px;font-size:13px;color:#6366f1;font-weight:700;letter-spacing:.04em;text-transform:uppercase">' . mail_esc($company) . '</p>'
        . '<h1 style="margin:0 0 18px;font-size:21px;color:#0f172a">' . mail_esc($heading) . '</h1>' . $p . $f . $b
        . ($foot !== '' ? '<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">' . mail_esc($foot) . '</p>' : '')
        . '</td></tr></table><p style="font-size:12px;color:#94a3b8;margin:14px 0 0">Sent by WorkPilot for ' . mail_esc($company) . '. Please do not reply to this email.</p></td></tr></table></body></html>';
}

// ---------- the emails WorkPilot sends ----------
function mail_welcome(string $to, string $name, string $tempPassword, bool $isReset = false): void
{
    $co = company() ? company()['name'] : 'WorkPilot';
    $code = company() ? company()['code'] : '';
    $url = app_url() . 'login' . ($code ? '?c=' . rawurlencode($code) : '');
    mail_queue(
        $to,
        $isReset ? "Your $co password was reset" : "Welcome to $co on WorkPilot",
        mail_html(
            $co,
            $isReset ? 'Your password was reset' : 'Welcome, ' . ($name ?: 'there'),
            [$isReset ? 'An administrator reset your password. Use the temporary password below to sign in.' : "A WorkPilot account was created for you. Use the details below to sign in. You will find attendance, leave, payslips and more inside.", 'Please change this password after you sign in (top-right menu, Change password). Do not share it.'],
            'Sign in',
            $url,
            [['Company code', $code], ['Email', $to], ['Temporary password', $tempPassword]]
        )
    );
}

function mail_reset_link(string $to, string $token): void
{
    $co = company() ? company()['name'] : 'WorkPilot';
    $code = company() ? company()['code'] : '';
    $url = app_url() . 'reset-password?t=' . rawurlencode($token) . ($code ? '&c=' . rawurlencode($code) : '');
    mail_queue($to, "Reset your $co password", mail_html($co, 'Reset your password', ['We received a request to reset your WorkPilot password. The link below works for 1 hour and only once.', 'If you did not ask for this, you can ignore this email. Your password stays the same.'], 'Choose a new password', $url));
}

function mail_password_changed(string $to): void
{
    $co = company() ? company()['name'] : 'WorkPilot';
    mail_queue($to, "Your $co password was changed", mail_html($co, 'Your password was changed', ['The password for ' . $to . ' was just changed.', 'If this was you, nothing more is needed. If it was not you, ask your administrator to reset your password straight away.']));
}

function mail_notification(string $to, array $p): void
{
    $co = company() ? company()['name'] : 'WorkPilot';
    $url = !empty($p['link']) ? app_url() . ltrim((string) $p['link'], '/') : null;
    mail_queue($to, (string) $p['title'], mail_html($co, (string) $p['title'], array_filter([(string) ($p['body'] ?? '')]), $url ? 'Open WorkPilot' : null, $url));
}
