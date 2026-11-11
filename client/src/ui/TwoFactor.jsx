import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Icon from './Icon'
import { Button, Modal, PasswordInput, useToast } from './components'

// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy ...).
// `call(path, { method, body })` makes the API request, `base` is '/auth/2fa' (company users) or '/platform/2fa' (platform owner).

function RecoveryCodes({ codes, onDone }) {
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  const text = codes.join('\n')
  const download = () => {
    const url = URL.createObjectURL(new Blob([`WorkPilot recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`], { type: 'text/plain' }))
    const a = document.createElement('a'); a.href = url; a.download = 'workpilot-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }
  return (
    <div style={{ display: 'grid', gap: '.9rem' }}>
      <p>Two-step sign-in is <b>on</b>. Save these <b>recovery codes</b> now. If you lose your phone, each code lets you sign in <b>once</b>. They are shown only this one time.</p>
      <div className="recovery-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <Button variant="light" icon="download" onClick={download}>Download</Button>
        <Button variant="light" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Select the codes and copy them', 'error'))}>Copy</Button>
        <Button variant="light" icon="printer" onClick={() => window.print()}>Print</Button>
      </div>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved my recovery codes</label>
      <div className="form-actions"><Button disabled={!saved} onClick={onDone}>Done</Button></div>
    </div>
  )
}

export function TwoFactorSetup({ call, base, onDone, onSignOut }) {
  const [step, setStep] = useState('intro') // intro | scan | codes
  const [info, setInfo] = useState(null)
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (info?.otpauth) QRCode.toDataURL(info.otpauth, { width: 220, margin: 1 }).then(setQr).catch(() => setQr('')) }, [info])
  const start = async () => { setBusy(true); setError(''); try { setInfo(await call(`${base}/setup`, { method: 'POST' })); setStep('scan') } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const confirm = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await call(`${base}/enable`, { method: 'POST', body: { code } }); setCodes(r.recovery_codes); setStep('codes') } catch (er) { setError(er.message) } finally { setBusy(false) }
  }
  if (step === 'codes') return <RecoveryCodes codes={codes} onDone={onDone} />
  if (step === 'scan') {
    return (
      <form style={{ display: 'grid', gap: '.9rem' }} onSubmit={confirm}>
        <ol style={{ paddingLeft: '1.2rem', display: 'grid', gap: '.35rem' }}>
          <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Authy).</li>
          <li>In the app choose <b>Add account → Scan a QR code</b> and scan this picture.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {qr ? <img src={qr} alt="QR code to scan with your authenticator app" width="180" height="180" style={{ background: '#fff', borderRadius: 12, padding: 6 }} /> : null}
          <div><small className="muted">Cannot scan? Enter this key in the app instead:</small><code className="recovery-key">{info.secret.match(/.{1,4}/g).join(' ')}</code></div>
        </div>
        <label className="field"><span>6-digit code from the app</span><input className="input" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoFocus /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><Button busy={busy}>Turn on two-step sign-in</Button></div>
      </form>
    )
  }
  return (
    <div style={{ display: 'grid', gap: '.9rem' }}>
      <p>Two-step sign-in protects this account even if the password is stolen: after the password, you also type a 6-digit code from an app on your phone.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{onSignOut && <Button variant="ghost" onClick={onSignOut}>Sign out</Button>}<Button busy={busy} icon="shield" onClick={start}>Set it up</Button></div>
    </div>
  )
}

// A screen that blocks everything until two-step sign-in is set up (administrators and the platform owner).
export function ForcedTwoFactor({ call, base, onDone, onSignOut }) {
  return (
    <div className="ct-shell">
      <main className="ct-card">
        <h2 style={{ marginBottom: '.4rem' }}>Set up two-step sign-in</h2>
        <p className="muted" style={{ marginBottom: '1rem' }}>Required for administrators. It takes about two minutes.</p>
        <TwoFactorSetup call={call} base={base} onDone={onDone} onSignOut={onSignOut} />
      </main>
    </div>
  )
}

// From the user menu: see the status, set it up, make new recovery codes, or switch it off (when allowed).
export function TwoFactorModal({ call, base, onClose, onChanged }) {
  const toast = useToast()
  const [st, setSt] = useState(null)
  const [mode, setMode] = useState('home') // home | setup | regen | off | codes
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => call(base).then(setSt).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const run = async (fn) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const regen = (e) => { e.preventDefault(); run(async () => { const r = await call(`${base}/recovery-codes`, { method: 'POST', body: { code } }); setCodes(r.recovery_codes); setMode('codes'); setCode(''); load() }) }
  const off = (e) => { e.preventDefault(); run(async () => { await call(`${base}/disable`, { method: 'POST', body: { password, code } }); toast('Two-step sign-in switched off'); onChanged?.(); onClose() }) }
  return (
    <Modal title="Two-step sign-in" onClose={onClose}>
      {!st ? <p className="muted">{error || 'Loading…'}</p> : mode === 'setup' ? (
        <TwoFactorSetup call={call} base={base} onDone={() => { onChanged?.(); onClose() }} />
      ) : mode === 'codes' ? <RecoveryCodes codes={codes} onDone={onClose} /> : mode === 'regen' ? (
        <form style={{ display: 'grid', gap: '.8rem' }} onSubmit={regen}>
          <p>Enter a current code from your app to make 8 new recovery codes. The old ones stop working.</p>
          <label className="field"><span>6-digit code</span><input className="input" required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions"><Button variant="ghost" type="button" onClick={() => { setMode('home'); setError('') }}>Back</Button><Button busy={busy}>Make new codes</Button></div>
        </form>
      ) : mode === 'off' ? (
        <form style={{ display: 'grid', gap: '.8rem' }} onSubmit={off}>
          <p>Switch two-step sign-in off? Your account will be protected by the password alone.</p>
          <label className="field"><span>Your password</span><PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <label className="field"><span>6-digit code</span><input className="input" required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions"><Button variant="ghost" type="button" onClick={() => { setMode('home'); setError('') }}>Back</Button><Button variant="danger" busy={busy}>Switch off</Button></div>
        </form>
      ) : (
        <div style={{ display: 'grid', gap: '.9rem' }}>
          <p style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><Icon name={st.enabled ? 'checkcircle' : 'alert'} size={18} />{st.enabled ? <>Two-step sign-in is <b>on</b>. {st.recovery_left} recovery code{st.recovery_left === 1 ? '' : 's'} left.</> : <>Two-step sign-in is <b>off</b>.{st.required ? ' It is required for your role.' : ''}</>}</p>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            {!st.enabled && <Button icon="shield" onClick={() => setMode('setup')}>Set up</Button>}
            {st.enabled && <Button variant="light" onClick={() => setMode('regen')}>New recovery codes</Button>}
            {st.enabled && !st.required && <Button variant="ghost" onClick={() => setMode('off')}>Switch off</Button>}
            {st.enabled && st.required && <small className="muted">Required for administrators, so it cannot be switched off.</small>}
          </div>
        </div>
      )}
    </Modal>
  )
}
