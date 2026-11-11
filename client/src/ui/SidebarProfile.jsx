import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import Icon from './Icon'
import { Avatar, useToast } from './components'
import { usePhotoUrl } from './photo'

const MAX_BYTES = 5 * 1024 * 1024

// Logged-in user's photo (with upload button) shown in the sidebar under the logo.
export default function SidebarProfile({ user }) {
  const toast = useToast()
  const qc = useQueryClient()
  const input = useRef(null)
  const id = user.employeeId
  const url = usePhotoUrl(id)
  const name = user.name || user.email.split('@')[0]
  const up = useMutation({
    mutationFn: (f) => { const fd = new FormData(); fd.append('type', 'Profile Photo'); fd.append('file', f); return api(`/employees/${id}/documents`, { method: 'POST', body: fd }) },
    onSuccess: () => { toast('Profile photo updated'); qc.invalidateQueries({ queryKey: ['docs', id] }) },
    onError: (er) => toast(er.message, 'error'),
  })
  const pick = (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''
    if (!f) return
    if (!['image/jpeg', 'image/png'].includes(f.type)) return toast('Use a JPG or PNG image', 'error')
    if (f.size > MAX_BYTES) return toast('Image is larger than 5 MB', 'error')
    up.mutate(f)
  }
  return (
    <div className="side-profile">
      <div className="photo-wrap">
        <Avatar name={name} size={56} src={url} />
        <input ref={input} type="file" accept=".jpg,.jpeg,.png" hidden onChange={pick} />
        <button type="button" className="photo-btn" title="Upload profile photo" aria-label="Upload profile photo" disabled={up.isPending} onClick={() => input.current.click()}><Icon name="upload" size={12} /></button>
      </div>
      <div className="side-profile-text"><b>{name}</b><small>{user.role}</small></div>
    </div>
  )
}
