import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './Layout'
import { useAuth } from './auth'
import { Card, Empty } from './ui/components'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import EmployeeDetail from './pages/EmployeeDetail'
import OrgChart from './pages/OrgChart'
import Attendance from './pages/Attendance'
import { QrScreen } from './pages/AttendanceRules'
import Leave from './pages/Leave'
import Overtime from './pages/Overtime'
import Approvals from './pages/Approvals'
import Payroll from './pages/Payroll'
import Payslips from './pages/Payslips'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import HrTests, { TestEditor } from './pages/HrTests'
import CandidateTest from './pages/CandidateTest'
import { HelpDesk, Policies, Assets } from './pages/HrDesk'
import Letters, { LetterView } from './pages/Letters'
import Platform from './pages/Platform'
import { ForgotPassword, ResetPassword } from './pages/PasswordPages'
import { Users, Announcements, AuditLog } from './pages/Admin'

// Server enforces permissions; this just avoids showing an empty page for URLs the user can't use.
function Guard({ perms, children }) {
  const { can, user } = useAuth()
  const allowed = perms === 'employee' ? !!user.employeeId : can(...perms)
  return allowed ? children : <Card><Empty icon="shield" title="You don't have access to this page" hint="Ask an administrator if you think this is a mistake." /></Card>
}
const guard = (perms, el) => <Guard perms={perms}>{el}</Guard>

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/candidate-test" element={<CandidateTest />} />
      <Route path="/platform" element={<Platform />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="attendance" element={guard('employee', <Attendance />)} />
        <Route path="attendance/qr" element={guard(['attendance.manage'], <QrScreen />)} />
        <Route path="leave" element={guard('employee', <Leave />)} />
        <Route path="overtime" element={guard('employee', <Overtime />)} />
        <Route path="letters" element={guard(['employee.manage'], <Letters />)} />
        <Route path="letters/:id" element={guard('employee', <LetterView />)} />
        <Route path="helpdesk" element={guard('employee', <HelpDesk />)} />
        <Route path="policies" element={guard('employee', <Policies />)} />
        <Route path="assets" element={guard(['employee.manage'], <Assets />)} />
        <Route path="payslips" element={guard('employee', <Payslips />)} />
        <Route path="approvals" element={guard(['leave.approve', 'attendance.view_team', 'attendance.manage'], <Approvals />)} />
        <Route path="employees" element={guard(['employee.view'], <Employees />)} />
        <Route path="employees/:id" element={guard(['employee.view'], <EmployeeDetail />)} />
        <Route path="profile" element={guard('employee', <EmployeeDetail />)} />
        <Route path="org-chart" element={<OrgChart />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="payroll" element={guard(['payroll.view_all'], <Payroll />)} />
        <Route path="tests" element={guard(['employee.manage'], <HrTests />)} />
        <Route path="tests/:id" element={guard(['employee.manage'], <TestEditor />)} />
        <Route path="reports" element={guard(['report.view'], <Reports />)} />
        <Route path="settings" element={guard(['org.manage', 'leave.manage', 'attendance.manage'], <Settings />)} />
        <Route path="users" element={guard(['user.manage'], <Users />)} />
        <Route path="audit" element={guard(['audit.view'], <AuditLog />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
