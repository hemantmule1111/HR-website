<?php
// Entry point for every /api/v1/... request (the .htaccess file sends them here).
require __DIR__ . '/../app/bootstrap.php';
run_request();
