import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, blobUrl, fetchBlob } from '../api'

// Object URL of an employee's uploaded profile photo, or null if none.
export function usePhotoUrl(employeeId) {
  const { data: docs } = useQuery({ queryKey: ['docs', employeeId], queryFn: () => api(`/employees/${employeeId}/documents`), enabled: !!employeeId })
  const photoId = docs?.find((d) => d.type === 'Profile Photo')?.id
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!photoId) { setUrl(null); return }
    let dead = false, u
    blobUrl(`/employees/${employeeId}/documents/${photoId}/download`).then((x) => { u = x; if (dead) URL.revokeObjectURL(x); else setUrl(x) }).catch(() => {})
    return () => { dead = true; if (u) URL.revokeObjectURL(u) }
  }, [photoId, employeeId])
  return url
}

// Object URL (+ mime type) for any authenticated file path.
export function useBlob(path) {
  const [state, setState] = useState({ url: null, type: '', error: false })
  useEffect(() => {
    if (!path) return
    let dead = false, u
    setState({ url: null, type: '', error: false })
    fetchBlob(path).then((b) => { u = URL.createObjectURL(b); if (dead) URL.revokeObjectURL(u); else setState({ url: u, type: b.type, error: false }) }).catch(() => { if (!dead) setState({ url: null, type: '', error: true }) })
    return () => { dead = true; if (u) URL.revokeObjectURL(u) }
  }, [path])
  return state
}
