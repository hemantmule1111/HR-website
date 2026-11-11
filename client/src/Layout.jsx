import { useEffect, useRef, useState } from 'react'
import { useI18n, LanguagePicker } from './i18n'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'
import Icon from './ui/Icon'
import { Avatar, Button, Field, Loading, Modal, PasswordInput, useToast } from './ui/components'
import { usePhotoUrl } from './ui/photo'
import SidebarProfile from './ui/SidebarProfile'
import BackToTop from './ui/BackToTop'
import ChatWidget from './ui/Chat'
import BrandLogo from './ui/BrandLogo'
import { ForcedTwoFactor, TwoFactorModal } from './ui/TwoFactor'
import { getCompany } from './api'
import { useCompany } from './ui/Payslip'
import { timeAgo } from './ui/format'

const TITLES = {
  '/': 'Dashboard', '/attendance': 'Attendance', '/leave': 'Leave', '/helpdesk': 'Help desk', '/policies': 'Company policies', '/assets': 'Assets', '/letters': 'Letters', '/tests': 'HR tests', '/overtime': 'Overtime', '/payslips': 'My payslips', '/approvals': 'Approvals',
  '/employees': 'Employees', '/org-chart': 'Org chart', '/payroll': 'Payroll', '/reports': 'Reports', '/announcements': 'Announcements',
  '/settings': 'Organization settings', '/users': 'Users & access', '/audit': 'Audit log', '/profile': 'My profile',
}

function useOutside(ref, close) {
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && close()
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, close])
}

function Notifications() {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const nav = useNavigate()
  const qc = useQueryClient()
  useOutside(ref, () => setOpen(false))
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api('/notifications'), refetchInterval: 60000 })
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) })
  const read = useMutation({ mutationFn: (id) => api(`/notifications/${id}/read`, { method: 'PATCH' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) })
  const unread = data?.unread || 0
  return (
    <div className="rel" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <header><strong>Notifications</strong>{unread > 0 && <Button variant="ghost" className="sm" onClick={() => readAll.mutate()}>Mark all read</Button>}</header>
          {!data?.items.length && <p className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>You're all caught up 🎉</p>}
          {data?.items.map((n) => (
            <button key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => { if (!n.read_at) read.mutate(n.id); if (n.link) nav(n.link); setOpen(false) }}>
              <span className="event-icon" style={{ background: 'var(--grad)' }}><Icon name={n.type === 'leave' ? 'calendar' : n.type === 'payroll' ? 'wallet' : n.type === 'announcement' ? 'megaphone' : 'bell'} size={16} /></span>
              <span><b>{n.title}</b>{n.body && <small>{n.body}</small>}<small style={{ display: 'block' }}>{timeAgo(n.created_at)}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PasswordModal({ onClose, forced = false }) {
  const toast = useToast()
  const { logout } = useAuth()
  const [f, setF] = useState({ currentPassword: '', newPassword: '' })
  const m = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: f }),
    onSuccess: async () => { toast('Password changed. Please sign in again.'); await logout() },
  })
  return (
    <Modal title={forced ? 'Choose your own password' : 'Change password'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        {forced && <p className="muted span-2" style={{ gridColumn: 'span 2' }}>Your administrator gave you a temporary password. Choose a password only you know to continue. You will then sign in again.</p>}
        <Field label={forced ? 'Temporary password' : 'Current password'} span={2}><PasswordInput required autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password" hint="At least 10 characters" span={2}><PasswordInput required minLength={10} autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}>
          {forced ? <Button variant="ghost" type="button" onClick={logout}>Sign out</Button> : <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>}
          <Button busy={m.isPending}>Update password</Button>
        </div>
      </form>
    </Modal>
  )
}

function UserMenu({ onPassword, onTwoFactor }) {
  const { user, logout, can } = useAuth()
  const { t } = useI18n()
  const isAdmin = ['user.manage', 'payroll.manage', 'org.manage'].every((k) => can(k))
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const nav = useNavigate()
  useOutside(ref, () => setOpen(false))
  const name = user.name || user.email.split('@')[0]
  const photo = usePhotoUrl(user.employeeId)
  return (
    <div className="rel" ref={ref}>
      <button className="user-chip" onClick={() => setOpen(!open)}>
        <Avatar name={name} size={32} src={photo} /><span>{name}</span>
      </button>
      {open && (
        <div className="menu">
          {user.employeeId && <button onClick={() => { nav('/profile'); setOpen(false) }}><Icon name="users" size={16} />{t('My profile')}</button>}
          <button onClick={() => { onPassword(); setOpen(false) }}><Icon name="key" size={16} />{t('Change password')}</button>
          <button onClick={() => { onTwoFactor(); setOpen(false) }}><Icon name="shield" size={16} />{t('Two-step sign-in')}</button>
          {isAdmin && <button onClick={() => { nav('/payroll?tab=master'); setOpen(false) }}><Icon name="sliders" size={16} />{t('Master sheet')}</button>}
          <a href={`${import.meta.env.BASE_URL}documentation`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}><Icon name="file" size={16} />{t('Documentation')}</a>
          <div style={{ padding: '.3rem .6rem' }}><LanguagePicker style={{ width: '100%' }} /></div>
          <hr />
          <button onClick={logout}><Icon name="logout" size={16} />{t('Sign out')}</button>
        </div>
      )}
    </div>
  )
}

const PROFILE_TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['career', 'Career'], ['salary', 'Salary'], ['assets', 'Assets'], ['letters', 'Letters']]

// "My profile" with a dropdown: each item opens the profile on that tab.
function ProfileNav({ open, setOpen }) {
  const { t } = useI18n()
  const loc = useLocation()
  const onProfile = loc.pathname === '/profile'
  const wanted = new URLSearchParams(loc.search).get('tab') || 'overview'
  const current = onProfile ? (PROFILE_TABS.some(([id]) => id === wanted) ? wanted : 'overview') : null
  return (
    <div className={`nav-sub ${open ? 'open' : ''}`}>
      <button type="button" className={`nav-link nav-parent ${onProfile ? 'active' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="profile-menu">
        <Icon name="user" />{t('My profile')}<Icon name="chevdown" size={16} className="nav-chev" />
      </button>
      <div className="nav-children" id="profile-menu">
        <div className="nav-children-inner">
          {PROFILE_TABS.map(([id, label]) => (
            <NavLink key={id} to={id === 'overview' ? '/profile' : `/profile?tab=${id}`} className={() => `nav-link nav-child ${current === id ? 'active' : ''}`} tabIndex={open ? 0 : -1}>{label}</NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const { user, loading, can, has, logout, refresh } = useAuth()
  const { t } = useI18n()
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light')
  const [menu, setMenu] = useState(false)
  // The My profile dropdown is open only on the profile pages, or when you open it yourself; any other menu item closes it.
  const [profileOpen, setProfileOpen] = useState(false)
  const [pw, setPw] = useState(false)
  const [tf, setTf] = useState(false)
  const loc = useLocation()
  const { data: company } = useCompany()
  const brandVersion = company?.has_logo ? String(company.updated_at || '1') : ''
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard/summary'), enabled: !!user })

  useEffect(() => { setMenu(false) }, [loc.pathname, loc.search])
  useEffect(() => {
    // The browser-tab icon follows the website logo too.
    const icon = document.querySelector('link[rel="icon"]')
    if (icon && brandVersion) icon.href = `${import.meta.env.BASE_URL}api/v1/branding/logo?c=${encodeURIComponent(getCompany())}&v=${encodeURIComponent(brandVersion)}`
  }, [brandVersion])
  useEffect(() => { setProfileOpen(loc.pathname === '/profile') }, [loc.pathname])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* private mode */ }
  }, [theme])

  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <div className="ct-shell"><PasswordModal forced onClose={() => {}} /></div>
  if (user.mustSetupTwoFactor) return <ForcedTwoFactor call={api} base="/auth/2fa" onDone={refresh} onSignOut={logout} />

  const pending = dash?.approvals?.total || 0
  const isAdmin = ['user.manage', 'payroll.manage', 'org.manage'].every((k) => can(k))
  const onMaster = loc.pathname === '/payroll' && new URLSearchParams(loc.search).get('tab') === 'master'
  const link = (to, icon, label, extra) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive && !(to === '/payroll' && onMaster) ? 'active' : ''}`} onClick={() => setProfileOpen(false)}><Icon name={icon} />{t(label)}{extra}</NavLink>
  )
  const title = t(TITLES[loc.pathname] || (loc.pathname.startsWith('/letters/') ? 'Letter' : loc.pathname.startsWith('/tests/') ? 'HR tests' : loc.pathname.startsWith('/employees/') ? 'Employee' : 'WorkPilot'))
  const showApprovals = can('leave.approve', 'attendance.view_team', 'attendance.manage')

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>{t('Skip to content')}</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <NavLink to="/" className="brand brand-home" aria-label="WorkPilot: go to the Dashboard" title="Go to the Dashboard" onClick={() => setProfileOpen(false)}><BrandLogo version={brandVersion} /></NavLink>
        {user.employeeId && <SidebarProfile user={user} />}
        <nav className="nav-group">
          <span className="nav-title">{t('Workspace')}</span>
          {link('/', 'home', 'Dashboard')}
          {isAdmin && <NavLink to="/payroll?tab=master" className={() => `nav-link ${onMaster ? 'active' : ''}`} onClick={() => setProfileOpen(false)}><Icon name="sliders" />{t('Master sheet')}</NavLink>}
          {user.employeeId && <ProfileNav open={profileOpen} setOpen={setProfileOpen} />}
          {user.employeeId && link('/attendance', 'clock', 'Attendance')}
          {user.employeeId && link('/leave', 'calendar', 'Leave')}
          {user.employeeId && has('overtime') && link('/overtime', 'trending', 'Overtime')}
          {user.employeeId && has('payroll') && link('/payslips', 'wallet', 'My payslips')}
          {user.employeeId && has('hrdesk') && link('/helpdesk', 'inbox', 'Help desk')}
          {user.employeeId && has('hrdesk') && link('/policies', 'file', 'Policies')}
          {showApprovals && link('/approvals', 'checkcircle', 'Approvals', pending > 0 && <span className="pill">{pending}</span>)}
        </nav>
        <nav className="nav-group">
          <span className="nav-title">{t('People')}</span>
          {can('employee.view') && link('/employees', 'users', 'Employees')}
          {link('/org-chart', 'sitemap', 'Org chart')}
          {link('/announcements', 'megaphone', 'Announcements')}
        </nav>
        {can('payroll.view_all', 'employee.manage', 'report.view', 'org.manage', 'leave.manage', 'attendance.manage', 'user.manage', 'audit.view') && (
          <nav className="nav-group">
            <span className="nav-title">{t('Administration')}</span>
            {can('payroll.view_all') && has('payroll') && link('/payroll', 'wallet', 'Payroll')}
            {can('employee.manage') && has('tests') && link('/tests', 'award', 'HR tests')}
            {can('employee.manage') && has('hrdesk') && link('/assets', 'briefcase', 'Assets')}
            {can('employee.manage') && has('letters') && link('/letters', 'file', 'Letters')}
            {can('report.view') && link('/reports', 'chart', 'Reports')}
            {can('org.manage', 'leave.manage', 'attendance.manage') && link('/settings', 'sliders', 'Org settings')}
            {can('user.manage') && link('/users', 'shield', 'Users & access')}
            {can('audit.view') && link('/audit', 'file', 'Audit log')}
          </nav>
        )}
        <button className="sidebar-logout" onClick={logout}><Icon name="logout" size={14} />{t('Logout')}</button>
      </aside>
      <div className={`scrim ${menu ? 'show' : ''}`} onClick={() => setMenu(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <span className="crumb">{title}</span>
          <span id="crumb-extra" className="crumb-extra" />
          <span className="spacer" />
          <span id="crumb-center" className="crumb-center" />
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          <Notifications />
          <UserMenu onPassword={() => setPw(true)} onTwoFactor={() => setTf(true)} />
        </header>
        <main className="content" id="main" tabIndex={-1} key={loc.pathname}><Outlet /></main>
      </div>
      {pw && <PasswordModal onClose={() => setPw(false)} />}
      {tf && <TwoFactorModal call={api} base="/auth/2fa" onClose={() => setTf(false)} onChanged={refresh} />}
      <BackToTop />
      {has('chat') && <ChatWidget />}
    </div>
  )
}
