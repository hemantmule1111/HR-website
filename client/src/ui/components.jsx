import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { hueFor, initials } from './format'

export function Avatar({ name, size = 36, src }) {
  if (src) return <img className="avatar photo-img" src={src} alt={name} style={{ width: size, height: size }} />
  const hue = hueFor(name)
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 40) % 360} 75% 52%))` }}>
      {initials(name)}
    </span>
  )
}

const TONES = {
  present: 'green', approved: 'green', active: 'green', paid: 'green', verified: 'green',
  pending: 'amber', probation: 'amber', draft: 'amber', half_day: 'amber', half_leave: 'amber', notice: 'amber',
  absent: 'red', rejected: 'red', exited: 'red', inactive: 'red', cancelled: 'gray',
  leave: 'violet', holiday: 'blue', weekoff: 'gray', upcoming: 'gray', na: 'gray',
}
export function Badge({ children, tone, status }) {
  const t = tone || TONES[status] || 'gray'
  return <span className={`badge ${t}`}>{children ?? status}</span>
}

export function Card({ title, action, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <h3>{title}</h3>
          {action}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  )
}

export function Button({ icon, variant = 'primary', busy, children, className = '', ...rest }) {
  return (
    <button {...rest} className={`btn ${variant} ${className}`} disabled={busy || rest.disabled}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

export function Empty({ icon = 'inbox', title, hint }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
    </div>
  )
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />
}

export function Loading() {
  return <div className="center-pad"><Spinner /></div>
}

export function Modal({ title, onClose, children, wide, className = "" }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
// A password box with a button that shows or hides what you typed.
export function PasswordInput({ className = 'input', ...rest }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="pw-wrap">
      <input {...rest} className={className} type={shown ? 'text' : 'password'} />
      <button type="button" className="pw-toggle" onClick={() => setShown((v) => !v)} onMouseDown={(e) => e.preventDefault()} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'}>
        <Icon name={shown ? 'eyeoff' : 'eye'} size={18} />
      </button>
    </span>
  )
}

export function Field({ label, hint, children, span }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count > 0 && <em>{t.count}</em>}
        </button>
      ))}
    </div>
  )
}

export function Stat({ icon, label, value, hint, tone = 'indigo' }) {
  return (
    <div className="stat">
      <span className={`stat-icon ${tone}`}><Icon name={icon} size={20} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  )
}

// ---- Toasts ----
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, type = 'success') => {
    const id = Math.random()
    setItems((s) => [...s, { id, message, type }])
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <Icon name={t.type === 'error' ? 'alert' : 'checkcircle'} size={18} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{message}</p>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
