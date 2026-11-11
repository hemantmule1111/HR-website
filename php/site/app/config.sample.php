<?php
// Copy this file to config.php (same folder) and fill in your details. Never share config.php.
return [
    // Your MySQL database (cPanel -> MySQL Databases). On cPanel the names usually start with your account name.
    'db_driver' => 'mysql',
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'PUT_DATABASE_NAME_HERE',
    'db_user' => 'PUT_DATABASE_USER_HERE',
    'db_password' => 'PUT_DATABASE_PASSWORD_HERE',

    // A long random string. Used to sign people in. Change it once, before anyone signs in, and then leave it alone.
    'jwt_secret' => 'PUT_A_LONG_RANDOM_STRING_HERE',

    'company_tz' => 'Asia/Kolkata',

    // Where uploaded files (documents, logo, chat files) are kept. Leave empty to use app/storage/uploads.
    'upload_dir' => '',

    // Email me when the site hits an unexpected error (needs working email below). Empty = no emails.
    // 'alert_email' => 'you@yourdomain.com',

    // Email (welcome emails, password reset, leave / payslip / subscription notices). Optional: with nothing here the host's own mail() is used,
    // which works on most cPanel hosts. For the most reliable delivery, create a mailbox in cPanel (Email Accounts), e.g. noreply@yourdomain.com,
    // and use SMTP. Then sign in at /platform and press "Test email".
    // 'mail' => [
    //     'transport' => 'smtp',                    // smtp | php | log (log writes to app/storage/mail.log instead of sending)
    //     'host' => 'mail.yourdomain.com', 'port' => 587, 'secure' => 'tls',   // tls = port 587, ssl = port 465
    //     'user' => 'noreply@yourdomain.com', 'pass' => 'the mailbox password',
    //     'from' => 'noreply@yourdomain.com', 'from_name' => 'WorkPilot',
    // ],
    // The address people open from email links (worked out automatically when empty):
    // 'app_url' => 'https://hr.wpart.co.in/',

    // Attendance reminders ("you forgot to check out") run by themselves every few minutes. To switch off: 'reminders' => ['auto' => false],
    // Automatic daily database backup (saved in app/storage/backups, newest 14 kept; the platform owner downloads them at /platform -> Backups).
    // It runs by itself about once a day. A cPanel cron job is more reliable (see the guide). To switch the automatic one off: 'backup' => ['auto' => false],

    // Set to true only while fixing a problem: it shows the real error message in the response.
    'debug' => false,
];
