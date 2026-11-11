import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from './components'

// Opens the camera, lets the person take a selfie, and hands back a small JPEG (as text) for the punch.
export default function Selfie({ title = 'Take a selfie', optional = false, confirmLabel = 'Use this photo', onDone, onClose }) {
  const video = useRef(null)
  const stream = useRef(null)
  const [shot, setShot] = useState(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }
  const start = async () => {
    setError(''); setReady(false); setShot(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocamera')
      if (window.isSecureContext === false) throw new Error('insecure')
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}) }
      setReady(true)
    } catch (e) {
      setError(e.message === 'insecure' ? 'The camera only works on a secure (https) page.'
        : e.message === 'nocamera' ? 'This browser cannot use the camera. Please use a current version of Chrome, Edge, Safari or Firefox.'
          : e.name === 'NotAllowedError' ? 'Camera access is blocked. Click the padlock next to the address, allow Camera, then try again.'
            : e.name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not be started. Close other apps that use it and try again.')
    }
  }
  useEffect(() => { start(); return stop }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const snap = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const w = 320
    const h = Math.round((v.videoHeight / v.videoWidth) * w)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.translate(w, 0); ctx.scale(-1, 1) // the preview is mirrored, so the saved photo matches what the person saw
    ctx.drawImage(v, 0, 0, w, h)
    setShot(c.toDataURL('image/jpeg', 0.72))
    stop()
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="selfie">
        {error ? <p className="form-error">{error}</p> : shot
          ? <img src={shot} alt="Your photo" />
          : <video ref={video} muted playsInline aria-label="Camera preview" />}
        {!error && !shot && !ready && <small className="muted">Starting the camera…</small>}
      </div>
      <p className="muted" style={{ fontSize: '.82rem', marginTop: '.5rem' }}>Your photo is saved with this punch so HR can check it. Look at the camera in good light.</p>
      <div className="form-actions">
        {optional && <Button variant="ghost" type="button" onClick={() => onDone(null)}>Skip the photo</Button>}
        {error && <Button variant="light" type="button" onClick={start}>Try again</Button>}
        {!error && !shot && <Button type="button" disabled={!ready} onClick={snap}>Take photo</Button>}
        {shot && <><Button variant="ghost" type="button" onClick={start}>Retake</Button><Button type="button" onClick={() => onDone(shot)}>{confirmLabel}</Button></>}
      </div>
    </Modal>
  )
}
