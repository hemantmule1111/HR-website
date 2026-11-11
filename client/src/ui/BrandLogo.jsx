import { useState } from 'react'
import { getCompany } from '../api'

// The website logo: the one uploaded on the Master sheet, or the built-in logo until one is uploaded.
export default function BrandLogo({ version, className = 'brand-logo' }) {
  const [failed, setFailed] = useState(false)
  const base = import.meta.env.BASE_URL
  const c = getCompany()
  const qs = [c && `c=${encodeURIComponent(c)}`, version && `v=${encodeURIComponent(version)}`].filter(Boolean).join('&')
  const src = failed ? `${base}logo.png` : `${base}api/v1/branding/logo${qs ? `?${qs}` : ''}`
  return <img className={className} src={src} alt="WorkPilot" onError={() => setFailed(true)} />
}
