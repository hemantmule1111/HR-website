import { useCallback, useEffect, useRef, useState } from 'react'
import BrandLogo from '../ui/BrandLogo'
import Icon from '../ui/Icon'
import { Button } from '../ui/components'
import { getCompany } from '../api'

// The candidate's screens. No staff account: they sign in with the email HR registered and an access code.
const KEY = 'wp-candidate-token'
const store = {
  get: () => { try { return sessionStorage.getItem(KEY) } catch { return null } },
  set: (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY) } catch { /* private mode */ } },
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/v1/candidate-test${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Test-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(data.error || `Something went wrong (${res.status})`); e.status = res.status; throw e }
  return data
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

function Shell({ children, wide }) {
  return (
    <div className="ct-shell">
      <header className="ct-head"><BrandLogo /><span className="muted">Candidate test</span></header>
      <main className={`ct-card ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  )
}

function SignIn({ onSignedIn }) {
  const [company, setCompany] = useState(new URLSearchParams(window.location.search).get('c') || getCompany() || '')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await call('/login', { method: 'POST', body: { email, code, company: company.trim() || undefined } }); store.set(r.token); onSignedIn(r.token) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Shell>
      <form className="login-form" onSubmit={submit} style={{ width: '100%' }}>
        <div><h2>Welcome</h2><p className="muted" style={{ marginTop: '.3rem' }}>Sign in with the email address HR has on record for you and the access code they gave you.</p></div>
        <label className="field"><span>Company code</span><input className="input" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Given to you by HR" autoCapitalize="none" spellCheck="false" /></label>
        <label className="field"><span>Your email</span><input className="input" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Access code</span><input className="input" required inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" /></label>
        {error && <p className="form-error">{error}</p>}
        <Button busy={busy}>Continue</Button>
      </form>
    </Shell>
  )
}

function Test({ token, session, onDone, onExpired }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries(session.questions.map((q) => [q.id, { selected_option: q.selected_option, answer_text: q.answer_text }])))
  const [left, setLeft] = useState(session.seconds_left)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const endAt = useRef(Date.now() + session.seconds_left * 1000)
  const latest = useRef(answers)
  const submitted = useRef(false)
  latest.current = answers
  const payload = useCallback(() => ({ answers: session.questions.map((q) => ({ question_id: q.id, ...(q.type === 'mcq' ? { selected_option: latest.current[q.id]?.selected_option ?? null } : { answer_text: latest.current[q.id]?.answer_text ?? '' }) })) }), [session.questions])

  const submit = useCallback(async () => {
    if (submitted.current) return
    submitted.current = true; setBusy(true); setError('')
    try { await call('/submit', { method: 'POST', body: payload(), token }); store.set(null); onDone() } catch (e) {
      if (e.status === 401) { store.set(null); onDone() } else { submitted.current = false; setBusy(false); setError(`${e.message}. Please press Submit again.`) }
    }
  }, [token, payload, onDone])

  useEffect(() => {
    const t = setInterval(() => { const s = Math.max(0, Math.round((endAt.current - Date.now()) / 1000)); setLeft(s); if (s <= 0) submit() }, 1000)
    return () => clearInterval(t)
  }, [submit])
  useEffect(() => { // save in the background so a closed tab or a power cut loses nothing
    const t = setInterval(() => { if (!submitted.current) call('/answers', { method: 'PUT', body: payload(), token }).catch((e) => { if (e.status === 401) onExpired() }) }, 10000)
    return () => clearInterval(t)
  }, [token, payload, onExpired])
  useEffect(() => {
    const warn = (e) => { if (!submitted.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const set = (id, patch) => setAnswers({ ...answers, [id]: { ...answers[id], ...patch } })
  const answered = session.questions.filter((q) => (q.type === 'mcq' ? answers[q.id]?.selected_option !== null && answers[q.id]?.selected_option !== undefined : String(answers[q.id]?.answer_text || '').trim())).length
  return (
    <Shell wide>
      <div className="ct-bar">
        <div><b>{session.test.title}</b><small className="muted" style={{ display: 'block' }}>{session.name} · {answered} of {session.questions.length} answered</small></div>
        <div className={`ct-timer ${left < 120 ? 'low' : ''}`}><Icon name="clock" size={18} />{mmss(left)}</div>
      </div>
      <ol className="ct-questions">
        {session.questions.map((q) => (
          <li key={q.id}>
            <p className="ct-q"><b>{q.question}</b> <small className="muted">({q.marks} mark{q.marks === 1 ? '' : 's'})</small></p>
            {q.type === 'mcq' ? q.options.map((o, i) => (
              <label key={i} className={`ct-opt ${answers[q.id]?.selected_option === i ? 'on' : ''}`}>
                <input type="radio" name={`q${q.id}`} checked={answers[q.id]?.selected_option === i} onChange={() => set(q.id, { selected_option: i })} />{o}
              </label>
            )) : <textarea className="input" rows={5} maxLength={5000} placeholder="Type your answer here" value={answers[q.id]?.answer_text || ''} onChange={(e) => set(q.id, { answer_text: e.target.value })} />}
          </li>
        ))}
      </ol>
      {error && <p className="form-error">{error}</p>}
      <div className="ct-submit">
        {confirm ? (
          <>
            <span>{answered < session.questions.length ? `${session.questions.length - answered} question(s) are not answered. ` : ''}Submit your test now? You cannot change answers afterwards.</span>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Go back</Button>
            <Button busy={busy} onClick={submit}>Yes, submit</Button>
          </>
        ) : <Button onClick={() => setConfirm(true)}>Submit test</Button>}
      </div>
    </Shell>
  )
}

export default function CandidateTest() {
  const [token, setToken] = useState(store.get())
  const [session, setSession] = useState(null)
  const [state, setState] = useState(store.get() ? 'loading' : 'signin') // signin | loading | intro | test | done
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (t) => {
    try {
      const s = await call('/session', { token: t })
      setSession(s); setToken(t)
      setState(s.status === 'in_progress' ? 'test' : s.status === 'submitted' ? 'done' : 'intro')
    } catch { store.set(null); setToken(null); setState('signin') }
  }, [])
  useEffect(() => { if (token && state === 'loading') load(token) }, [token, state, load])

  async function start() {
    setBusy(true); setError('')
    try { await call('/start', { method: 'POST', token }); await load(token) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const signOut = () => { store.set(null); setToken(null); setSession(null); setState('signin') }

  if (state === 'signin') return <SignIn onSignedIn={(t) => { setToken(t); setState('loading') }} />
  if (state === 'loading') return <Shell><p className="muted">Loading…</p></Shell>
  if (state === 'done') return (
    <Shell>
      <div style={{ textAlign: 'center', display: 'grid', gap: '.8rem', justifyItems: 'center' }}>
        <span className="stat-icon green"><Icon name="checkcircle" size={26} /></span>
        <h2>Thank you</h2>
        <p className="muted">Your test has been submitted. HR will look at your answers and be in touch. You can close this page.</p>
        <Button variant="light" onClick={signOut}>Finish</Button>
      </div>
    </Shell>
  )
  if (state === 'intro') return (
    <Shell>
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div><h2>Hello, {session.name}</h2><p className="muted">{session.test.title}</p></div>
        <div className="ct-facts"><div><b>{session.question_count}</b><small>questions</small></div><div><b>{session.total_marks}</b><small>marks</small></div><div><b>{session.test.duration_minutes}</b><small>minutes</small></div></div>
        {session.test.description && <p style={{ whiteSpace: 'pre-wrap' }}>{session.test.description}</p>}
        <ul className="muted ct-rules">
          <li>The timer starts when you press Start and cannot be paused.</li>
          <li>Your answers are saved as you go. The test is submitted automatically when time is up.</li>
          <li>Please do not refresh or close this page.</li>
        </ul>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions"><Button variant="ghost" onClick={signOut}>Not me</Button><Button busy={busy} onClick={start}>Start the test</Button></div>
      </div>
    </Shell>
  )
  return <Test token={token} session={session} onDone={() => setState('done')} onExpired={signOut} />
}
