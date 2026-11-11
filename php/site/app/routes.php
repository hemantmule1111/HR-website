<?php
// Every API route: [method, path, permissions, handler].
//   permissions: null = open to everyone (sign-in), [] = any signed-in user, ['a','b'] = needs any one of them.

function routes(): array
{
    $sec = fn(string $t, string $e, bool $hard = false, string $order = 'id') => [
        'list' => fn() => org_list($t, $order),
        'create' => fn() => org_create($t, $e),
        'update' => fn($p) => org_update($t, $e, $p),
        'remove' => fn($p) => org_remove($t, $e, $hard, $p),
    ];

    $r = [
        ['GET', '/health', null, fn() => respond(['ok' => true])],
        // Platform owner area: manages companies.
        ['POST', '/platform/auth/login', null, 'plat_login'],
        ['POST', '/platform/auth/verify', null, 'plat_verify'],
        ['GET', '/platform/2fa', null, 'plat_2fa_status'],
        ['POST', '/platform/2fa/setup', null, 'plat_2fa_setup'],
        ['POST', '/platform/2fa/enable', null, 'plat_2fa_enable'],
        ['POST', '/platform/2fa/recovery-codes', null, 'plat_2fa_recovery'],
        ['GET', '/platform/me', null, 'plat_me'],
        ['POST', '/platform/change-password', null, 'plat_change_password'],
        ['GET', '/platform/overview', null, 'plat_overview'],
        ['GET', '/platform/log', null, 'plat_log_list'],
        ['GET', '/platform/features', null, 'plat_features'],
        ['GET', '/platform/companies/:id/health', null, 'plat_health'],
        ['DELETE', '/platform/companies/:id', null, 'plat_delete'],
        ['GET', '/platform/companies', null, 'plat_list'],
        ['POST', '/platform/companies', null, 'plat_create'],
        ['PATCH', '/platform/companies/:id', null, 'plat_update'],
        ['POST', '/platform/companies/:id/reset-admin', null, 'plat_reset_admin'],
        ['POST', '/platform/upgrade', null, 'plat_upgrade'],
        ['GET', '/platform/backups', null, 'plat_backups'],
        ['POST', '/platform/backups', null, 'plat_backup_now'],
        ['GET', '/platform/backups/:name', null, 'plat_backup_download'],
        ['GET', '/platform/companies/:id/export', null, 'plat_export'],
        ['POST', '/platform/test-email', null, 'plat_test_email'],
        ['GET', '/auth/host-company', null, 'auth_host_company'],
        ['POST', '/auth/login', null, 'auth_login'],
        ['POST', '/auth/forgot-password', null, 'auth_forgot_password'],
        ['GET', '/export', [], 'export_company'],
        // HR desk: help desk, policies, assets
        ['GET', '/helpdesk/tickets', [], 'hd_tickets'],
        ['POST', '/helpdesk/tickets', [], 'hd_ticket_create'],
        ['GET', '/helpdesk/tickets/:id', [], 'hd_ticket_get'],
        ['PATCH', '/helpdesk/tickets/:id', [], 'hd_ticket_update'],
        ['POST', '/helpdesk/tickets/:id/comments', [], 'hd_comment_add'],
        ['GET', '/policies', [], 'hd_policies'],
        ['POST', '/policies', ['employee.manage'], 'hd_policy_create'],
        ['POST', '/policies/:id', ['employee.manage'], 'hd_policy_update'],
        ['PATCH', '/policies/:id', ['employee.manage'], 'hd_policy_update'],
        ['DELETE', '/policies/:id', ['employee.manage'], 'hd_policy_delete'],
        ['GET', '/policies/:id/download', [], 'hd_policy_download'],
        ['POST', '/policies/:id/acknowledge', [], 'hd_policy_ack'],
        ['GET', '/policies/:id/acks', ['employee.manage'], 'hd_policy_acks'],
        ['GET', '/assets', ['employee.manage'], 'hd_assets'],
        ['POST', '/assets', ['employee.manage'], 'hd_asset_create'],
        ['GET', '/assets/:id', ['employee.manage'], 'hd_asset_history'],
        ['PATCH', '/assets/:id', ['employee.manage'], 'hd_asset_update'],
        ['DELETE', '/assets/:id', ['employee.manage'], 'hd_asset_delete'],
        ['POST', '/assets/:id/assign', ['employee.manage'], 'hd_asset_assign'],
        ['POST', '/assets/:id/return', ['employee.manage'], 'hd_asset_return'],
        ['GET', '/employees/:id/assets', [], 'hd_employee_assets'],
        // Letters
        ['GET', '/letters/templates', ['employee.manage'], 'ltr_templates'],
        ['POST', '/letters/templates', ['employee.manage'], 'ltr_template_create'],
        ['PATCH', '/letters/templates/:id', ['employee.manage'], 'ltr_template_update'],
        ['DELETE', '/letters/templates/:id', ['employee.manage'], 'ltr_template_delete'],
        ['POST', '/letters/preview', ['employee.manage'], 'ltr_preview'],
        ['GET', '/letters', [], 'ltr_list'],
        ['POST', '/letters', ['employee.manage'], 'ltr_create'],
        ['GET', '/letters/:id', [], 'ltr_get'],
        ['DELETE', '/letters/:id', ['employee.manage'], 'ltr_delete'],
        ['POST', '/auth/2fa/verify', null, 'tf_verify_login'],
        ['GET', '/auth/2fa', [], 'tf_status'],
        ['POST', '/auth/2fa/setup', [], 'tf_setup'],
        ['POST', '/auth/2fa/enable', [], 'tf_enable'],
        ['POST', '/auth/2fa/disable', [], 'tf_disable'],
        ['POST', '/auth/2fa/recovery-codes', [], 'tf_regenerate'],
        ['POST', '/users/:id/reset-2fa', ['user.manage'], 'tf_reset_for'],
        ['POST', '/auth/reset-password', null, 'auth_reset_password'],
        // HR interview tests: a candidate signs in with the registered email and an access code (no staff account).
        ['POST', '/candidate-test/login', null, 'tst_candidate_login'],
        ['GET', '/candidate-test/session', null, 'tst_candidate_session'],
        ['POST', '/candidate-test/start', null, 'tst_candidate_start'],
        ['PUT', '/candidate-test/answers', null, 'tst_candidate_save'],
        ['POST', '/candidate-test/submit', null, 'tst_candidate_submit'],
        ['POST', '/auth/refresh', null, 'auth_refresh'],
        ['POST', '/auth/logout', null, 'auth_logout'],
        ['GET', '/auth/me', [], 'auth_me'],
        ['POST', '/auth/change-password', [], 'auth_change_password'],
    ];

    // Master data: everyone can read, managers write.
    $masters = [
        ['departments', 'department', false, 'id', 'org.manage'],
        ['designations', 'designation', false, 'id', 'org.manage'],
        ['shifts', 'shift', false, 'id', 'attendance.manage'],
        ['leave-types', 'leave_type', false, 'id', 'leave.manage', 'leave_types'],
        ['holidays', 'holiday', true, 'date', 'leave.manage'],
    ];
    foreach ($masters as $m) {
        $path = $m[0];
        $table = $m[5] ?? $m[0];
        $c = $sec($table, $m[1], $m[2], $m[3]);
        $r[] = ['GET', "/$path", ['org.view'], $c['list']];
        $r[] = ['POST', "/$path", [$m[4]], $c['create']];
        $r[] = ['PATCH', "/$path/:id", [$m[4]], $c['update']];
        $r[] = ['DELETE', "/$path/:id", [$m[4]], $c['remove']];
    }

    return array_merge($r, [
        // Users and roles
        ['GET', '/users', ['user.manage'], 'users_list'],
        ['GET', '/roles', ['user.manage', 'employee.manage'], 'users_roles'],
        ['POST', '/users', ['user.manage'], 'users_create'],
        ['PATCH', '/users/:id', ['user.manage'], 'users_update'],
        ['POST', '/users/:id/reset-password', ['user.manage'], 'users_reset_password'],

        // Employees
        ['GET', '/employees', ['employee.view'], 'emp_list'],
        ['GET', '/employees/me', [], 'emp_mine'],
        ['GET', '/employees/tree', ['org.view'], 'emp_tree'],
        ['POST', '/employees', ['employee.manage'], 'emp_create'],
        ['PATCH', '/employees/me', [], 'emp_update_me'],
        ['GET', '/employees/:id', ['employee.view'], 'emp_get'],
        ['PATCH', '/employees/:id', ['employee.manage'], 'emp_update'],
        ['GET', '/employees/:id/history', ['employee.view'], 'emp_history'],
        ['POST', '/employees/:id/events', ['employee.manage'], 'emp_add_event'],
        ['GET', '/employees/:id/documents', [], 'docs_list'],
        ['POST', '/employees/:id/documents', [], 'docs_add'],
        ['GET', '/employees/:id/documents/:docId/download', [], 'docs_download'],
        ['POST', '/employees/:id/documents/:docId/verify', ['employee.manage'], 'docs_verify'],
        ['DELETE', '/employees/:id/documents/:docId', [], 'docs_delete'], // owner (until verified) or HR; checked in the handler

        // Company profile (payslip letterhead)
        ['GET', '/company', [], 'company_get'],
        ['PUT', '/company', ['org.manage'], 'company_update'],
        ['GET', '/company/logo', [], 'company_logo_get'],
        ['GET', '/branding/logo', null, 'company_logo_get'], // public: the sign-in page shows the website logo
        ['POST', '/company/logo', [], 'company_logo_set'],
        ['DELETE', '/company/logo', [], 'company_logo_delete'],

        // Chat
        ['GET', '/chat/people', [], 'chat_people'],
        ['GET', '/chat/unread', [], 'chat_unread'],
        ['GET', '/chat/conversations', [], 'chat_conversations'],
        ['POST', '/chat/conversations', [], 'chat_create'],
        ['GET', '/chat/conversations/:id', [], 'chat_info'],
        ['GET', '/chat/conversations/:id/messages', [], 'chat_messages'],
        ['POST', '/chat/conversations/:id/messages', [], 'chat_send'],
        ['POST', '/chat/conversations/:id/read', [], 'chat_read'],
        ['POST', '/chat/conversations/:id/members', [], 'chat_add_members'],
        ['DELETE', '/chat/conversations/:id/members/me', [], 'chat_leave'],
        ['GET', '/chat/messages/:id/file', [], 'chat_file'],
        ['DELETE', '/chat/messages/:id', [], 'chat_delete'],

        // Attendance
        ['GET', '/attendance/geo', [], 'geo_public'],
        ['POST', '/device/punch', null, 'att_device_punch'], // machines sign in with their own key, not a user login
        ['GET', '/attendance/settings', [], 'att_settings_get'],
        ['PUT', '/attendance/settings', [], 'att_settings_update'],
        ['GET', '/attendance/qr', ['attendance.manage'], 'att_qr'],
        ['GET', '/attendance/devices', [], 'att_devices'],
        ['POST', '/attendance/devices', [], 'att_device_add'],
        ['PATCH', '/attendance/devices/:id', [], 'att_device_update'],
        ['DELETE', '/attendance/devices/:id', [], 'att_device_delete'],
        ['POST', '/attendance/reminders/run', [], 'att_reminders_now'],
        ['GET', '/attendance/:id/photo/:kind', [], 'att_photo'],
        // The office location(s) are set by the admin (Master sheet).
        ['GET', '/geo', [], 'geo_admin'],
        ['PUT', '/geo/settings', [], 'geo_settings_update'],
        ['POST', '/geo/locations', [], 'geo_location_add'],
        ['PATCH', '/geo/locations/:id', [], 'geo_location_update'],
        ['DELETE', '/geo/locations/:id', [], 'geo_location_delete'],
        ['POST', '/attendance/check-in', [], 'att_check_in'],
        ['POST', '/attendance/check-out', [], 'att_check_out'],
        ['GET', '/attendance/today', [], 'att_today'],
        ['GET', '/attendance/calendar', [], 'att_calendar'],
        ['GET', '/attendance/team', ['attendance.view_team', 'attendance.view_all'], 'att_team'],
        ['POST', '/attendance/regularizations', [], 'att_reg_create'],
        ['GET', '/attendance/regularizations', [], 'att_reg_list'],
        ['PATCH', '/attendance/regularizations/:id', ['attendance.view_team', 'attendance.manage'], 'att_reg_decide'],
        // HR tests (question bank and candidates): HR only.
        ['GET', '/tests', ['employee.manage'], 'tst_list'],
        ['POST', '/tests', ['employee.manage'], 'tst_create'],
        ['PATCH', '/tests/questions/:qid', ['employee.manage'], 'tst_question_update'],
        ['DELETE', '/tests/questions/:qid', ['employee.manage'], 'tst_question_delete'],
        ['GET', '/tests/:id', ['employee.manage'], 'tst_detail'],
        ['PATCH', '/tests/:id', ['employee.manage'], 'tst_update'],
        ['DELETE', '/tests/:id', ['employee.manage'], 'tst_delete'],
        ['POST', '/tests/:id/duplicate', ['employee.manage'], 'tst_duplicate'],
        ['POST', '/tests/:id/questions', ['employee.manage'], 'tst_question_add'],
        ['GET', '/test-candidates', ['employee.manage'], 'tst_candidates'],
        ['POST', '/test-candidates', ['employee.manage'], 'tst_invite'],
        ['GET', '/test-candidates/:id', ['employee.manage'], 'tst_candidate_get'],
        ['PATCH', '/test-candidates/:id', ['employee.manage'], 'tst_candidate_update'],
        ['POST', '/test-candidates/:id/grade', ['employee.manage'], 'tst_grade'],
        ['DELETE', '/test-candidates/:id', ['employee.manage'], 'tst_candidate_delete'],
        // Overtime: policy on the Master sheet (admin only); anyone with an employee record can claim; approvers decide.
        ['GET', '/overtime/settings', [], 'ot_settings_get'],
        ['PUT', '/overtime/settings', [], 'ot_settings_update'],
        ['GET', '/overtime/summary', [], 'ot_summary'],
        ['GET', '/overtime/requests', [], 'ot_list'],
        ['POST', '/overtime/requests', [], 'ot_create'],
        ['PATCH', '/overtime/requests/:id', [], 'ot_decide'],

        // Leave
        ['GET', '/leave/balances', [], 'leave_balances'],
        ['GET', '/leave/calendar', [], 'leave_calendar'],
        ['GET', '/leave/requests', [], 'leave_list'],
        ['POST', '/leave/requests', ['leave.apply'], 'leave_apply'],
        ['PATCH', '/leave/requests/:id', [], 'leave_decide'],

        // Notifications and announcements
        ['GET', '/notifications', [], 'notif_list'],
        ['POST', '/notifications/read-all', [], 'notif_mark_all'],
        ['PATCH', '/notifications/:id/read', [], 'notif_mark_read'],
        ['GET', '/announcements', [], 'announce_list'],
        ['POST', '/announcements', ['announcement.manage'], 'announce_create'],
        ['PATCH', '/announcements/:id', ['announcement.manage'], 'announce_update'],
        ['DELETE', '/announcements/:id', ['announcement.manage'], 'announce_delete'],

        // Dashboard and reports
        ['GET', '/dashboard/summary', [], 'dash_summary'],
        ['GET', '/reports/headcount', ['report.view'], 'report_headcount'],
        ['GET', '/reports/attendance', ['report.view'], 'report_attendance'],
        ['GET', '/reports/leave', ['report.view'], 'report_leave'],

        // Payroll
        ['GET', '/payroll/structures', [], 'struct_list'],
        ['GET', '/payroll/components', [], 'comp_list'],
        ['POST', '/payroll/components', [], 'comp_add'],
        ['PATCH', '/payroll/components/:id', [], 'comp_update'],
        ['DELETE', '/payroll/components/:id', [], 'comp_delete'],
        ['GET', '/payroll/rules', ['payroll.view_all'], 'rules_list'],
        ['POST', '/payroll/rules', ['payroll.manage'], 'rules_add'],
        ['POST', '/payroll/structures', ['payroll.manage'], 'struct_add'],
        ['GET', '/payroll/runs', ['payroll.view_all'], 'payroll_runs_list'],
        ['POST', '/payroll/runs', ['payroll.manage'], 'payroll_run_create'],
        ['GET', '/payroll/runs/:id/payslips', ['payroll.view_all'], 'payroll_run_payslips'],
        ['POST', '/payroll/runs/:id/recompute', ['payroll.manage'], 'payroll_recompute'],
        ['PATCH', '/payroll/runs/:id', ['payroll.manage'], 'payroll_advance'],
        ['DELETE', '/payroll/runs/:id', ['payroll.manage'], 'payroll_delete'],
        ['GET', '/payroll/payslips', [], 'payslips_mine'],
        // Payroll compliance
        ['GET', '/payroll/settings', ['payroll.view_all'], 'pc_settings_get'],
        ['PUT', '/payroll/settings', [], 'pc_settings_update'],
        ['GET', '/payroll/pt-states', [], 'pc_states'],
        ['GET', '/payroll/pt-slabs', ['payroll.view_all'], 'pc_slabs'],
        ['POST', '/payroll/pt-slabs', [], 'pc_slab_add'],
        ['PUT', '/payroll/pt-slabs/:id', [], 'pc_slab_update'],
        ['DELETE', '/payroll/pt-slabs/:id', [], 'pc_slab_delete'],
        ['GET', '/payroll/adjustments', ['payroll.view_all'], 'pc_adjustments'],
        ['POST', '/payroll/adjustments', ['payroll.manage'], 'pc_adjustment_add'],
        ['DELETE', '/payroll/adjustments/:id', ['payroll.manage'], 'pc_adjustment_delete'],
        ['POST', '/payroll/calc/gratuity', ['payroll.manage'], 'pc_calc_gratuity'],
        ['POST', '/payroll/calc/leave-encashment', ['payroll.manage'], 'pc_calc_leave'],
        ['POST', '/payroll/calc/bonus', ['payroll.manage'], 'pc_calc_bonus'],
        ['GET', '/payroll/runs/:id/export/:kind', ['payroll.manage'], 'pc_export'],
        ['GET', '/payroll/payslips/:id', [], 'payslip_get'],

        ['GET', '/audit-logs', ['audit.view'], 'audit_list'],
    ]);
}
