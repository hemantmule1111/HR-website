import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, passwordGate, requirePermission as can, requireAdmin } from '../middleware/auth.js';
import { wrap } from '../utils/http.js';
import * as salaryComponents from '../controllers/salaryComponents.js';
import * as auth from '../controllers/auth.js';
import * as org from '../controllers/org.js';
import * as users from '../controllers/users.js';
import * as emp from '../controllers/employees.js';
import * as att from '../controllers/attendance.js';
import * as attAdmin from '../controllers/attendanceAdmin.js';
import * as leave from '../controllers/leave.js';
import * as comms from '../controllers/comms.js';
import * as dash from '../controllers/dashboard.js';
import * as reports from '../controllers/reports.js';
import * as payroll from '../controllers/payroll.js';
import * as company from '../controllers/company.js';
import * as chat from '../controllers/chat.js';
import * as overtime from '../controllers/overtime.js';
import * as tests from '../controllers/tests.js';
import * as geo from '../controllers/geo.js';
import * as twoFactor from '../controllers/twoFactor.js';
import * as exportData from '../controllers/exportData.js';
import * as hr from '../controllers/hrDesk.js';
import * as letters from '../controllers/letters.js';
import * as compliance from '../controllers/payrollCompliance.js';
import * as platform from '../controllers/platform.js';
import { featureGate } from '../services/features.js';
import { resolveTenant } from '../middleware/tenant.js';
import { runWithoutCompany } from '../db/tenant.js';
import db from '../db/index.js';

const r = Router();

// Test runs on a developer machine can switch the limits off with DISABLE_RATE_LIMIT=true. Never set it on a live server.
const skip = () => process.env.DISABLE_RATE_LIMIT === 'true';
const loginLimiter = rateLimit({ skip, windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } });
// Slows down someone scraping data or deleting records in bulk with a stolen sign-in.
const apiLimiter = rateLimit({ skip, windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } });
const deleteLimiter = rateLimit({ skip, windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many delete requests. Please slow down.' } });
r.use(apiLimiter);
r.use((req, res, next) => (req.method === 'DELETE' ? deleteLimiter(req, res, next) : next()));
// ---- Platform owner area: manages companies; never touches a company's own tables directly ----
r.use('/platform', (_req, _res, next) => runWithoutCompany(() => next()));
r.post('/platform/auth/login', loginLimiter, wrap(platform.login));
r.post('/platform/auth/verify', loginLimiter, wrap(platform.verify));
r.get('/platform/2fa', platform.requirePlatform, wrap(platform.twoFactorStatus));
r.post('/platform/2fa/setup', platform.requirePlatform, wrap(platform.twoFactorSetup));
r.post('/platform/2fa/enable', platform.requirePlatform, wrap(platform.twoFactorEnable));
r.post('/platform/2fa/recovery-codes', platform.requirePlatform, wrap(platform.twoFactorRecovery));
r.post('/platform/auth/verify', loginLimiter, wrap(platform.verify));
r.get('/platform/2fa', platform.requirePlatform, wrap(platform.twoFactorStatus));
r.post('/platform/2fa/setup', platform.requirePlatform, wrap(platform.twoFactorSetup));
r.post('/platform/2fa/enable', platform.requirePlatform, wrap(platform.twoFactorEnable));
r.post('/platform/2fa/recovery-codes', platform.requirePlatform, wrap(platform.twoFactorRecovery));
r.get('/platform/me', platform.requirePlatform, wrap(platform.me));
r.post('/platform/change-password', platform.requirePlatform, wrap(platform.changePassword));
r.get('/platform/overview', platform.requirePlatform, wrap(platform.overview));
r.get('/platform/log', platform.requirePlatform, wrap(platform.activityLog));
r.get('/platform/features', platform.requirePlatform, wrap(platform.featureList));
r.get('/platform/companies/:id/health', platform.requirePlatform, wrap(platform.companyHealth));
r.delete('/platform/companies/:id', platform.requirePlatform, wrap(platform.deleteCompany));
r.get('/platform/companies', platform.requirePlatform, wrap(platform.listCompanies));
r.post('/platform/companies', platform.requirePlatform, wrap(platform.createCompany));
r.patch('/platform/companies/:id', platform.requirePlatform, wrap(platform.updateCompany));
r.post('/platform/companies/:id/reset-admin', platform.requirePlatform, wrap(platform.resetAdmin));
r.post('/platform/upgrade', platform.requirePlatform, wrap(platform.upgradeAll));
r.get('/platform/companies/:id/export', platform.requirePlatform, wrap(platform.exportCompany));
r.post('/platform/test-email', platform.requirePlatform, wrap(platform.testEmail));

r.post('/auth/logout', auth.logout);

// Everything below belongs to one company. resolveTenant picks it (from the token, or ?c=code on public pages).
r.use(resolveTenant);
r.use(featureGate); // parts of the product the company's plan does not include
r.post('/device/punch', loginLimiter, wrap(attAdmin.devicePunch)); // machines sign in with their own key, not a user login
r.get('/auth/host-company', wrap(auth.hostCompany));
r.post('/auth/login', loginLimiter, wrap(auth.login));
const forgotLimiter = rateLimit({ skip, windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again in an hour.' } });
const codeLimiter = rateLimit({ skip, windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait 15 minutes and try again.' } });
r.post('/auth/2fa/verify', codeLimiter, wrap(twoFactor.verifyLogin));
r.post('/auth/forgot-password', forgotLimiter, wrap(auth.forgotPassword));
r.post('/auth/reset-password', forgotLimiter, wrap(auth.resetPassword));
r.get('/branding/logo', wrap(company.logo)); // the website logo is public so the sign-in page can show it
// HR interview tests: a candidate signs in with the email HR registered and an access code (no staff account).
r.post('/candidate-test/login', loginLimiter, wrap(tests.candidateLogin));
r.get('/candidate-test/session', wrap(tests.candidateSession));
r.post('/candidate-test/start', wrap(tests.candidateStart));
r.put('/candidate-test/answers', wrap(tests.candidateSave));
r.post('/candidate-test/submit', wrap(tests.candidateSubmit));
r.post('/auth/refresh', wrap(auth.refresh));
r.use(authenticate);
r.use(passwordGate); // a temporary password must be replaced before anything else works
r.get('/auth/me', wrap(auth.me));
r.get('/auth/2fa', wrap(twoFactor.status));
r.get('/export', requireAdmin, wrap(exportData.exportCompany));

// ---- HR desk: help desk, policies, assets ----
r.get('/helpdesk/tickets', wrap(hr.listTickets));
r.post('/helpdesk/tickets', wrap(hr.createTicket));
r.get('/helpdesk/tickets/:id', wrap(hr.getTicket));
r.patch('/helpdesk/tickets/:id', wrap(hr.updateTicket));
r.post('/helpdesk/tickets/:id/comments', wrap(hr.addComment));
r.get('/policies', wrap(hr.listPolicies));
r.post('/policies', can('employee.manage'), hr.policyUploadMiddleware, wrap(hr.createPolicy));
r.post('/policies/:id', can('employee.manage'), hr.policyUploadMiddleware, wrap(hr.updatePolicy));
r.patch('/policies/:id', can('employee.manage'), hr.policyUploadMiddleware, wrap(hr.updatePolicy));
r.delete('/policies/:id', can('employee.manage'), wrap(hr.deletePolicy));
r.get('/policies/:id/download', wrap(hr.downloadPolicy));
r.post('/policies/:id/acknowledge', wrap(hr.acknowledgePolicy));
r.get('/policies/:id/acks', can('employee.manage'), wrap(hr.policyAcks));
r.get('/assets', can('employee.manage'), wrap(hr.listAssets));
r.post('/assets', can('employee.manage'), wrap(hr.createAsset));
r.get('/assets/:id', can('employee.manage'), wrap(hr.assetHistory));
r.patch('/assets/:id', can('employee.manage'), wrap(hr.updateAsset));
r.delete('/assets/:id', can('employee.manage'), wrap(hr.deleteAsset));
r.post('/assets/:id/assign', can('employee.manage'), wrap(hr.assignAsset));
r.post('/assets/:id/return', can('employee.manage'), wrap(hr.returnAsset));
r.get('/employees/:id/assets', wrap(hr.employeeAssets));

// ---- Letters ----
r.get('/letters/templates', can('employee.manage'), wrap(letters.listTemplates));
r.post('/letters/templates', can('employee.manage'), wrap(letters.createTemplate));
r.patch('/letters/templates/:id', can('employee.manage'), wrap(letters.updateTemplate));
r.delete('/letters/templates/:id', can('employee.manage'), wrap(letters.deleteTemplate));
r.post('/letters/preview', can('employee.manage'), wrap(letters.preview));
r.get('/letters', wrap(letters.listLetters));
r.post('/letters', can('employee.manage'), wrap(letters.createLetter));
r.get('/letters/:id', wrap(letters.getLetter));
r.delete('/letters/:id', can('employee.manage'), wrap(letters.deleteLetter)); // the company admin downloads their own data
r.post('/auth/2fa/setup', wrap(twoFactor.setup));
r.post('/auth/2fa/enable', codeLimiter, wrap(twoFactor.enable));
r.post('/auth/2fa/disable', codeLimiter, wrap(twoFactor.disable));
r.post('/auth/2fa/recovery-codes', codeLimiter, wrap(twoFactor.regenerate));
r.post('/auth/change-password', wrap(auth.changePassword));

// Master data: everyone can read, managers write.
const masters = [
  ['departments', org.departments, 'org.manage'],
  ['designations', org.designations, 'org.manage'],
  ['shifts', org.shifts, 'attendance.manage'],
  ['leave-types', org.leaveTypes, 'leave.manage'],
  ['holidays', org.holidays, 'leave.manage'],
];
for (const [path, c, perm] of masters) {
  r.get(`/${path}`, can('org.view'), wrap(c.list));
  r.post(`/${path}`, can(perm), wrap(c.create));
  r.patch(`/${path}/:id`, can(perm), wrap(c.update));
  r.delete(`/${path}/:id`, can(perm), wrap(c.remove));
}

// Users & roles
r.get('/users', can('user.manage'), wrap(users.list));
r.get('/roles', can('user.manage', 'employee.manage'), wrap(users.roles));
r.post('/users', can('user.manage'), wrap(users.create));
r.patch('/users/:id', can('user.manage'), wrap(users.update));
r.post('/users/:id/reset-password', can('user.manage'), wrap(users.resetPassword));
r.post('/users/:id/reset-2fa', can('user.manage'), wrap(twoFactor.resetFor));
r.post('/users/:id/reset-2fa', can('user.manage'), wrap(twoFactor.resetFor));

// Employees
r.get('/employees', can('employee.view'), wrap(emp.list));
r.get('/employees/me', wrap(emp.mine));
r.get('/employees/tree', can('org.view'), wrap(emp.tree));
r.post('/employees', can('employee.manage'), wrap(emp.create));
r.patch('/employees/me', wrap(emp.updateMe));
r.get('/employees/:id', can('employee.view'), wrap(emp.get));
r.patch('/employees/:id', can('employee.manage'), wrap(emp.update));
r.get('/employees/:id/history', can('employee.view'), wrap(emp.history));
r.post('/employees/:id/events', can('employee.manage'), wrap(emp.addEvent));
r.get('/employees/:id/documents', wrap(emp.listDocs));
// Check access before multer touches the disk.
const docGate = (req, _res, next) =>
  req.user.permissions.has('employee.manage') || Number(req.params.id) === req.user.employeeId
    ? next()
    : next(Object.assign(new Error('Not permitted'), { status: 403 }));
r.post('/employees/:id/documents', docGate, emp.uploadMiddleware, wrap(emp.addDoc));
r.get('/employees/:id/documents/:docId/download', wrap(emp.downloadDoc));
r.post('/employees/:id/documents/:docId/verify', can('employee.manage'), wrap(emp.verifyDoc));
r.delete('/employees/:id/documents/:docId', wrap(emp.deleteDoc)); // owner (until verified) or HR; checked in the handler

// Company profile (payslip letterhead): everyone reads, org managers write.
r.get('/company', wrap(company.get));
r.put('/company', can('org.manage'), wrap(company.update));
r.get('/company/logo', wrap(company.logo));
r.post('/company/logo', requireAdmin, company.uploadMiddleware, wrap(company.setLogo));
r.delete('/company/logo', requireAdmin, wrap(company.deleteLogo));

// Chat: direct messages, groups, an everyone channel and file sharing. Members only; checked inside each handler.
r.use('/chat', wrap(chat.touch));
r.get('/chat/people', wrap(chat.people));
r.get('/chat/unread', wrap(chat.unread));
r.get('/chat/conversations', wrap(chat.listConversations));
r.post('/chat/conversations', wrap(chat.createConversation));
r.get('/chat/conversations/:id', wrap(chat.conversationInfo));
r.get('/chat/conversations/:id/messages', wrap(chat.listMessages));
r.post('/chat/conversations/:id/messages', chat.sendGate, chat.uploadMiddleware, wrap(chat.sendMessage));
r.post('/chat/conversations/:id/read', wrap(chat.markConversationRead));
r.post('/chat/conversations/:id/members', wrap(chat.addMembers));
r.delete('/chat/conversations/:id/members/me', wrap(chat.leave));
r.get('/chat/messages/:id/file', wrap(chat.downloadFile));
r.delete('/chat/messages/:id', wrap(chat.deleteMessage));

// Attendance
r.get('/attendance/geo', wrap(geo.publicGeo));
// The office location(s) are set by the admin (Master sheet).
r.get('/geo', requireAdmin, wrap(geo.adminGeo));
r.put('/geo/settings', requireAdmin, wrap(geo.updateSettings));
r.post('/geo/locations', requireAdmin, wrap(geo.addLocation));
r.patch('/geo/locations/:id', requireAdmin, wrap(geo.updateLocation));
r.delete('/geo/locations/:id', requireAdmin, wrap(geo.deleteLocation));
r.get('/attendance/settings', wrap(attAdmin.getSettings));
r.put('/attendance/settings', requireAdmin, wrap(attAdmin.updateSettings));
r.get('/attendance/qr', can('attendance.manage'), wrap(attAdmin.qrCode));
r.get('/attendance/devices', requireAdmin, wrap(attAdmin.listDevices));
r.post('/attendance/devices', requireAdmin, wrap(attAdmin.addDevice));
r.patch('/attendance/devices/:id', requireAdmin, wrap(attAdmin.updateDevice));
r.delete('/attendance/devices/:id', requireAdmin, wrap(attAdmin.deleteDevice));
r.post('/attendance/reminders/run', requireAdmin, wrap(attAdmin.remindersNow));
r.get('/attendance/:id/photo/:kind', wrap(attAdmin.punchPhoto));
r.post('/attendance/check-in', wrap(att.checkIn));
r.post('/attendance/check-out', wrap(att.checkOut));
r.get('/attendance/today', wrap(att.todayStatus));
r.get('/attendance/calendar', wrap(att.calendar));
r.get('/attendance/team', can('attendance.view_team', 'attendance.view_all'), wrap(att.team));
r.post('/attendance/regularizations', wrap(att.createRegularization));
r.get('/attendance/regularizations', wrap(att.listRegularizations));
r.patch('/attendance/regularizations/:id', can('attendance.view_team', 'attendance.manage'), wrap(att.decideRegularization));
// HR tests (question bank and candidates): HR only.
r.get('/tests', can('employee.manage'), wrap(tests.listTests));
r.post('/tests', can('employee.manage'), wrap(tests.createTest));
r.patch('/tests/questions/:qid', can('employee.manage'), wrap(tests.updateQuestion));
r.delete('/tests/questions/:qid', can('employee.manage'), wrap(tests.deleteQuestion));
r.get('/tests/:id', can('employee.manage'), wrap(tests.getTestDetail));
r.patch('/tests/:id', can('employee.manage'), wrap(tests.updateTest));
r.delete('/tests/:id', can('employee.manage'), wrap(tests.deleteTest));
r.post('/tests/:id/duplicate', can('employee.manage'), wrap(tests.duplicateTest));
r.post('/tests/:id/questions', can('employee.manage'), wrap(tests.addQuestion));
r.get('/test-candidates', can('employee.manage'), wrap(tests.listCandidates));
r.post('/test-candidates', can('employee.manage'), wrap(tests.inviteCandidate));
r.get('/test-candidates/:id', can('employee.manage'), wrap(tests.candidateDetail));
r.patch('/test-candidates/:id', can('employee.manage'), wrap(tests.updateCandidate));
r.post('/test-candidates/:id/grade', can('employee.manage'), wrap(tests.gradeCandidate));
r.delete('/test-candidates/:id', can('employee.manage'), wrap(tests.deleteCandidate));
// Overtime: the policy is set on the Master sheet (admin only); anyone with an employee record can claim; approvers decide.
r.get('/overtime/settings', wrap(overtime.getSettings));
r.put('/overtime/settings', requireAdmin, wrap(overtime.updateSettings));
r.get('/overtime/summary', wrap(overtime.summary));
r.get('/overtime/requests', wrap(overtime.listRequests));
r.post('/overtime/requests', wrap(overtime.createRequest));
r.patch('/overtime/requests/:id', wrap(overtime.decideRequest));

// Leave
r.get('/leave/balances', wrap(leave.balances));
r.get('/leave/calendar', wrap(leave.calendar));
r.get('/leave/requests', wrap(leave.list));
r.post('/leave/requests', can('leave.apply'), wrap(leave.apply));
r.patch('/leave/requests/:id', wrap(leave.decide));

// Communication
r.get('/notifications', wrap(comms.listNotifications));
r.post('/notifications/read-all', wrap(comms.markAllRead));
r.patch('/notifications/:id/read', wrap(comms.markRead));
r.get('/announcements', wrap(comms.listAnnouncements));
r.post('/announcements', can('announcement.manage'), wrap(comms.createAnnouncement));
r.patch('/announcements/:id', can('announcement.manage'), wrap(comms.updateAnnouncement));
r.delete('/announcements/:id', can('announcement.manage'), wrap(comms.deleteAnnouncement));

// Dashboard & reports
r.get('/dashboard/summary', wrap(dash.summary));
r.get('/reports/headcount', can('report.view'), wrap(reports.headcount));
r.get('/reports/attendance', can('report.view'), wrap(reports.attendanceMonthly));
r.get('/reports/leave', can('report.view'), wrap(reports.leaveUtilization));

// Payroll
r.get('/payroll/structures', wrap(payroll.listStructures));
r.get('/payroll/components', wrap(salaryComponents.listComponents));
r.post('/payroll/components', requireAdmin, wrap(salaryComponents.addComponent));
r.patch('/payroll/components/:id', requireAdmin, wrap(salaryComponents.updateComponent));
r.delete('/payroll/components/:id', requireAdmin, wrap(salaryComponents.deleteComponent));
r.get('/payroll/rules', can('payroll.view_all'), wrap(payroll.listRules));
r.post('/payroll/rules', can('payroll.manage'), wrap(payroll.addRule));
r.post('/payroll/structures', can('payroll.manage'), wrap(payroll.addStructure));
r.get('/payroll/runs', can('payroll.view_all'), wrap(payroll.listRuns));
r.post('/payroll/runs', can('payroll.manage'), wrap(payroll.createRun));
r.get('/payroll/runs/:id/payslips', can('payroll.view_all'), wrap(payroll.runPayslips));
r.post('/payroll/runs/:id/recompute', can('payroll.manage'), wrap(payroll.recompute));
r.patch('/payroll/runs/:id', can('payroll.manage'), wrap(payroll.advanceRun));
r.delete('/payroll/runs/:id', can('payroll.manage'), wrap(payroll.deleteRun));
r.get('/payroll/payslips', wrap(payroll.myPayslips));
// Payroll compliance: second approver, professional tax slabs, adjustments, calculators, statutory files
r.get('/payroll/settings', can('payroll.view_all'), wrap(compliance.getSettings));
r.put('/payroll/settings', requireAdmin, wrap(compliance.updateSettings));
r.get('/payroll/pt-states', wrap(compliance.listStates));
r.get('/payroll/pt-slabs', can('payroll.view_all'), wrap(compliance.listSlabs));
r.post('/payroll/pt-slabs', requireAdmin, wrap(compliance.addSlab));
r.put('/payroll/pt-slabs/:id', requireAdmin, wrap(compliance.updateSlab));
r.delete('/payroll/pt-slabs/:id', requireAdmin, wrap(compliance.deleteSlab));
r.get('/payroll/adjustments', can('payroll.view_all'), wrap(compliance.listAdjustments));
r.post('/payroll/adjustments', can('payroll.manage'), wrap(compliance.addAdjustment));
r.delete('/payroll/adjustments/:id', can('payroll.manage'), wrap(compliance.deleteAdjustment));
r.post('/payroll/calc/gratuity', can('payroll.manage'), wrap(compliance.calcGratuity));
r.post('/payroll/calc/leave-encashment', can('payroll.manage'), wrap(compliance.calcLeaveEncashment));
r.post('/payroll/calc/bonus', can('payroll.manage'), wrap(compliance.calcBonus));
r.get('/payroll/runs/:id/export/:kind', can('payroll.manage'), wrap(compliance.exportRun));
r.get('/payroll/payslips/:id', wrap(payroll.getPayslip));

r.get(
  '/audit-logs',
  can('audit.view'),
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const rows = await db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id')
      .select('a.*', 'u.email as user_email').orderBy('a.id', 'desc').limit(limit).offset(offset);
    res.json(rows);
  }),
);

export default r;
