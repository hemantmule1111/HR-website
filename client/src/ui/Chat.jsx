import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, download } from '../api'
import { useAuth } from '../auth'
import Icon from './Icon'
import { Avatar, Button, Confirm, Loading, Modal, useToast } from './components'
import { useBlob } from './photo'

const MAX_BYTES = 10 * 1024 * 1024
const EMOJI = ['😀', '😂', '😊', '😍', '👍', '🙏', '🎉', '🔥', '❤️', '👏', '😮', '😢', '🤝', '✅', '👀', '💯']

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
function dayLabel(iso) {
  const d = new Date(iso), now = new Date()
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getTime() - 86400000))) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
function listTime(iso) {
  if (!iso) return ''
  return sameDay(iso, new Date()) ? clock(iso) : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })
}
const sizeLabel = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const preview = (last) => {
  if (!last) return 'No messages yet'
  if (last.deleted) return 'Message deleted'
  const who = last.mine ? 'You: ' : ''
  return `${who}${last.body || (last.file_name ? `📎 ${last.file_name}` : '')}`
}

const NOTIFY_KEY = 'workpilot-chat-notify'
const notifySupported = () => typeof Notification !== 'undefined'
function readNotifyPref() { try { return localStorage.getItem(NOTIFY_KEY) !== 'off' } catch { return true } }
function writeNotifyPref(on) { try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off') } catch { /* storage unavailable */ } }

function Linkify({ text }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => (/^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
    : part))
}

function ConvAvatar({ conv, size = 40 }) {
  if (conv.type === 'direct') {
    return <span className="chat-av"><Avatar name={conv.name} size={size} />{conv.other?.online && <i className="chat-online" />}</span>
  }
  return <span className="chat-av chat-group" style={{ width: size, height: size }}><Icon name="users" size={size * 0.45} /></span>
}

function ChatImage({ id, onOpen }) {
  const { url, error } = useBlob(`/chat/messages/${id}/file`)
  if (error) return <span className="muted">Image unavailable</span>
  return url ? <img className="chat-img" src={url} alt="attachment" onClick={() => onOpen(url)} /> : <span className="chat-img chat-img-load" />
}

function Bubble({ m, group, onDelete, onOpenImage }) {
  const toast = useToast()
  if (m.deleted) return <div className={`chat-row ${m.mine ? 'mine' : ''}`}><div className="chat-bubble deleted"><i>This message was deleted</i></div></div>
  return (
    <div className={`chat-row ${m.mine ? 'mine' : ''}`}>
      <div className="chat-bubble">
        {group && !m.mine && <b className="chat-sender">{m.sender_name}</b>}
        {m.file?.image && <ChatImage id={m.id} onOpen={onOpenImage} />}
        {m.file && !m.file.image && (
          <button type="button" className="chat-file" onClick={() => download(`/chat/messages/${m.id}/file`, m.file.name).catch((e) => toast(e.message, 'error'))}>
            <span className="chat-file-icon"><Icon name="file" size={18} /></span>
            <span className="chat-file-meta"><b>{m.file.name}</b><small>{sizeLabel(m.file.size)} · Download</small></span>
          </button>
        )}
        {m.body && <p><Linkify text={m.body} /></p>}
        <span className="chat-meta">
          {clock(m.created_at)}
          {m.mine && <span className={`chat-ticks ${m.read_by > 0 ? 'seen' : ''}`} title={m.read_by > 0 ? 'Seen' : 'Sent'}>{m.read_by > 0 ? '✓✓' : '✓'}</span>}
        </span>
        {m.mine && <button type="button" className="chat-del" aria-label="Delete message" title="Delete" onClick={() => onDelete(m)}><Icon name="trash" size={13} /></button>}
      </div>
    </div>
  )
}

function InfoModal({ conv, onClose, onLeft }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['chat', 'info', conv.id], queryFn: () => api(`/chat/conversations/${conv.id}`) })
  const { data: people = [] } = useQuery({ queryKey: ['chat', 'people'], queryFn: () => api('/chat/people') })
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const add = useMutation({
    mutationFn: () => api(`/chat/conversations/${conv.id}/members`, { method: 'POST', body: { user_ids: picked } }),
    onSuccess: () => { toast('Members added'); setPicked([]); setAdding(false); qc.invalidateQueries({ queryKey: ['chat'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  const leave = useMutation({
    mutationFn: () => api(`/chat/conversations/${conv.id}/members/me`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chat'] }); onLeft() },
    onError: (e) => toast(e.message, 'error'),
  })
  if (!data) return <Modal title={conv.name} onClose={onClose}><Loading /></Modal>
  const have = new Set(data.members.map((m) => m.id))
  const candidates = people.filter((p) => !have.has(p.id))
  return (
    <Modal title={conv.name} onClose={onClose}>
      <p className="muted" style={{ marginBottom: '.75rem' }}>{data.members.length} {conv.type === 'everyone' ? 'people — everyone in the company' : 'members'}</p>
      <div className="chat-people">
        {data.members.map((p) => (
          <div className="chat-person" key={p.id}>
            <span className="chat-av"><Avatar name={p.name} size={34} />{p.online && <i className="chat-online" />}</span>
            <div><b>{p.name}</b><small>{p.designation || p.role}</small></div>
          </div>
        ))}
      </div>
      {conv.type === 'group' && (
        <div style={{ marginTop: '1rem' }}>
          {!adding ? <Button variant="light" icon="userplus" onClick={() => setAdding(true)}>Add people</Button> : (
            <>
              <div className="chat-people short">
                {candidates.map((p) => (
                  <label className="chat-person pick" key={p.id}>
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
                    <div><b>{p.name}</b><small>{p.designation || p.role}</small></div>
                  </label>
                ))}
                {!candidates.length && <p className="muted">Everyone is already in this group.</p>}
              </div>
              <div className="form-actions"><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button busy={add.isPending} disabled={!picked.length} onClick={() => add.mutate()}>Add {picked.length || ''}</Button></div>
            </>
          )}
          <div className="form-actions" style={{ marginTop: '.75rem' }}><Button variant="ghost" icon="logout" onClick={() => leave.mutate()}>Leave group</Button></div>
        </div>
      )}
    </Modal>
  )
}

function Thread({ conv, onBack, onLeft }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [limit, setLimit] = useState(60)
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [emoji, setEmoji] = useState(false)
  const [over, setOver] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [del, setDel] = useState(null)
  const [info, setInfo] = useState(false)
  const box = useRef(null)
  const fileInput = useRef(null)
  const area = useRef(null)
  const lastSeen = useRef(0)
  const stick = useRef(true)

  const { data, isLoading } = useQuery({
    queryKey: ['chat', 'msgs', conv.id, limit],
    queryFn: () => api(`/chat/conversations/${conv.id}/messages?limit=${limit}`),
    refetchInterval: 3000,
  })
  const messages = data?.messages || []
  const lastId = messages.length ? messages[messages.length - 1].id : 0

  // Mark as read whenever something newer than what we've acknowledged is on screen.
  useEffect(() => {
    if (!lastId || lastSeen.current === lastId) return
    const theirs = messages.some((m) => !m.mine && m.id > (data?.last_read_id || 0))
    lastSeen.current = lastId
    if (theirs || conv.unread > 0) {
      api(`/chat/conversations/${conv.id}/read`, { method: 'POST' }).then(() => {
        qc.invalidateQueries({ queryKey: ['chat', 'convs'] }); qc.invalidateQueries({ queryKey: ['chat', 'unread'] })
      }).catch(() => {})
    }
  }, [lastId])
  useEffect(() => { lastSeen.current = 0; stick.current = true; setText(''); setFile(null) }, [conv.id])

  // Keep the newest message in view, unless the reader scrolled up to look at older ones.
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lastId, isLoading, lightbox])
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }

  const send = useMutation({
    mutationFn: () => { const fd = new FormData(); if (text.trim()) fd.append('body', text.trim()); if (file) fd.append('file', file); return api(`/chat/conversations/${conv.id}/messages`, { method: 'POST', body: fd }) },
    onSuccess: () => {
      setText(''); setFile(null); setEmoji(false); stick.current = true
      qc.invalidateQueries({ queryKey: ['chat', 'msgs', conv.id] }); qc.invalidateQueries({ queryKey: ['chat', 'convs'] })
      area.current?.focus()
    },
    onError: (e) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (m) => api(`/chat/messages/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chat', 'msgs', conv.id] }); qc.invalidateQueries({ queryKey: ['chat', 'convs'] }) },
    onError: (e) => toast(e.message, 'error'),
  })

  const choose = (f) => {
    if (!f) return
    if (f.size > MAX_BYTES) return toast('Files must be 10 MB or smaller', 'error')
    setFile(f)
  }
  const canSend = (text.trim() || file) && !send.isPending
  const onKey = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); if (canSend) send.mutate() } }

  const items = []
  messages.forEach((m, i) => {
    if (i === 0 || !sameDay(messages[i - 1].created_at, m.created_at)) items.push(<div className="chat-day" key={`d${m.id}`}><span>{dayLabel(m.created_at)}</span></div>)
    items.push(<Bubble key={m.id} m={m} group={conv.type !== 'direct'} onDelete={setDel} onOpenImage={setLightbox} />)
  })

  return (
    <div className={`chat-thread ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files[0]) }}>
      <header className="chat-head">
        <button type="button" className="icon-btn chat-back" onClick={onBack} aria-label="Back"><Icon name="left" /></button>
        <ConvAvatar conv={conv} size={38} />
        <div className="chat-head-text">
          <b>{conv.name}</b>
          <small>{conv.type === 'direct' ? (conv.other?.online ? <span className="chat-status on">● Online</span> : 'Offline') : `${conv.member_count} ${conv.type === 'everyone' ? 'people' : 'members'}`}</small>
        </div>
        {conv.type !== 'direct' && <button type="button" className="icon-btn" onClick={() => setInfo(true)} aria-label="Members" title="Members"><Icon name="users" /></button>}
      </header>

      <div className="chat-scroll" ref={box} onScroll={onScroll}>
        {isLoading ? <Loading /> : (
          <>
            {data?.has_more && <button type="button" className="chat-more" onClick={() => setLimit((l) => l + 60)}>Load earlier messages</button>}
            {!messages.length && <div className="chat-empty-thread"><Icon name="chat" size={30} /><p>No messages yet.<br />Say hello 👋</p></div>}
            {items}
          </>
        )}
        {over && <div className="chat-drop">Drop a file to attach it</div>}
      </div>

      <footer className="chat-composer">
        {file && (
          <div className="chat-attach">
            <Icon name="file" size={16} /><span>{file.name}</span><small>{sizeLabel(file.size)}</small>
            <button type="button" className="icon-btn" onClick={() => setFile(null)} aria-label="Remove attachment"><Icon name="x" size={14} /></button>
          </div>
        )}
        {emoji && <div className="chat-emoji">{EMOJI.map((e) => <button type="button" key={e} onClick={() => { setText((t) => t + e); area.current?.focus() }}>{e}</button>)}</div>}
        <div className="chat-input">
          <input ref={fileInput} type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" onChange={(e) => { choose(e.target.files[0]); e.target.value = '' }} />
          <button type="button" className="icon-btn" onClick={() => fileInput.current.click()} aria-label="Attach a file" title="Attach a file (max 10 MB)"><Icon name="clip" /></button>
          <button type="button" className="icon-btn" onClick={() => setEmoji((v) => !v)} aria-label="Emoji" title="Emoji"><Icon name="smile" /></button>
          <textarea ref={area} rows={1} value={text} placeholder="Type a message…" maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          <button type="button" className="chat-send" disabled={!canSend} onClick={() => send.mutate()} aria-label="Send"><Icon name="send" size={18} /></button>
        </div>
      </footer>

      {lightbox && <Modal wide title="Image" onClose={() => setLightbox(null)}><img className="doc-viewer-img" src={lightbox} alt="" style={{ maxHeight: '70vh' }} /></Modal>}
      {del && <Confirm danger title="Delete message?" message="This removes the message (and its file) for everyone in the chat." confirmLabel="Delete" onConfirm={() => { remove.mutate(del); setDel(null) }} onClose={() => setDel(null)} />}
      {info && <InfoModal conv={conv} onClose={() => setInfo(false)} onLeft={() => { setInfo(false); onLeft() }} />}
    </div>
  )
}

function People({ onPick, onBack, group }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const { data = [], isLoading } = useQuery({ queryKey: ['chat', 'people'], queryFn: () => api('/chat/people'), refetchInterval: 15000 })
  const list = useMemo(() => data.filter((p) => `${p.name} ${p.designation || ''} ${p.department || ''}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const make = useMutation({
    mutationFn: (body) => api('/chat/conversations', { method: 'POST', body }),
    onSuccess: onPick,
    onError: (e) => toast(e.message, 'error'),
  })
  return (
    <>
      <div className="chat-side-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="left" /></button>
        <b>{group ? 'New group' : 'New chat'}</b>
      </div>
      {group && <input className="input chat-search" placeholder="Group name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
      <input className="input chat-search" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chat-list">
        {isLoading ? <Loading /> : list.map((p) => (
          <button type="button" key={p.id} className={`chat-item ${group && picked.includes(p.id) ? 'active' : ''}`}
            onClick={() => (group ? setPicked((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])) : make.mutate({ type: 'direct', user_id: p.id }))}>
            <span className="chat-av"><Avatar name={p.name} size={40} />{p.online && <i className="chat-online" />}</span>
            <span className="chat-item-text"><b>{p.name}</b><small>{p.designation || p.role}{p.department ? ` · ${p.department}` : ''}</small></span>
            {group && <span className={`chat-check ${picked.includes(p.id) ? 'on' : ''}`}>{picked.includes(p.id) && <Icon name="check" size={12} />}</span>}
          </button>
        ))}
        {!isLoading && !list.length && <p className="muted chat-none">No one found.</p>}
      </div>
      {group && (
        <div className="chat-side-foot">
          <Button busy={make.isPending} disabled={!name.trim() || !picked.length} onClick={() => make.mutate({ type: 'group', name: name.trim(), member_ids: picked })}>Create group ({picked.length})</Button>
        </div>
      )}
    </>
  )
}

export default function ChatWidget() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [mode, setMode] = useState('chats')
  const [q, setQ] = useState('')
  const baseTitle = useRef(document.title)

  const toast = useToast()
  const [perm, setPerm] = useState(notifySupported() ? Notification.permission : 'unsupported')
  const [pref, setPref] = useState(readNotifyPref)
  const notifyOn = perm === 'granted' && pref

  // Always poll (a bit slower while the panel is closed) so new messages can raise a desktop notification.
  const convs = useQuery({ queryKey: ['chat', 'convs'], queryFn: () => api('/chat/conversations'), enabled: !!user, refetchInterval: open ? 5000 : 8000 })
  const list = useMemo(() => convs.data || [], [convs.data])
  const total = list.reduce((n, c) => n + c.unread, 0)
  const active = list.find((c) => c.id === activeId) || null

  const live = useRef({})
  live.current = { open, activeId, notifyOn }
  const seen = useRef(null) // conversation id -> newest message id we have already dealt with
  useEffect(() => {
    if (!convs.data) return
    if (!seen.current) { seen.current = new Map(convs.data.map((c) => [c.id, c.last?.id || 0])); return } // don't announce old messages on load
    for (const c of convs.data) {
      const prev = seen.current.get(c.id) ?? 0
      const lastId = c.last?.id || 0
      seen.current.set(c.id, lastId)
      if (!c.last || c.last.mine || c.last.deleted || lastId <= prev) continue
      const { open: o, activeId: a, notifyOn: on } = live.current
      const looking = o && a === c.id && document.visibilityState === 'visible' && document.hasFocus()
      if (!on || looking) continue
      const text = c.last.body || (c.last.file_name ? `📎 ${c.last.file_name}` : 'New message')
      try {
        const n = new Notification(c.type === 'direct' ? c.name : `${c.last.sender_name} · ${c.name}`, {
          body: c.unread > 1 ? `${c.unread} new messages · ${text}` : text, tag: `chat-${c.id}`, renotify: true, icon: `${import.meta.env.BASE_URL}logo.png`,
        })
        n.onclick = () => { window.focus(); setOpen(true); setActiveId(c.id); setMode('chats'); n.close() }
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }, [convs.data])

  const toggleNotify = async () => {
    if (perm === 'unsupported') return toast('This browser does not support desktop notifications', 'error')
    if (perm === 'denied') return toast('Notifications are blocked for this site. Click the lock icon in the address bar and allow them.', 'error')
    if (perm === 'default') {
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p === 'granted') { setPref(true); writeNotifyPref(true); toast('Desktop notifications are on') }
      return undefined
    }
    const next = !pref
    setPref(next); writeNotifyPref(next)
    return toast(next ? 'Desktop notifications are on' : 'Desktop notifications are off')
  }

  useEffect(() => { document.title = total ? `(${total}) ${baseTitle.current}` : baseTitle.current }, [total])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('.modal-backdrop') && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const filtered = useMemo(() => list.filter((c) => c.name?.toLowerCase().includes(q.toLowerCase())), [list, q])
  const started = (c) => { qc.invalidateQueries({ queryKey: ['chat', 'convs'] }); setActiveId(c.id); setMode('chats') }

  if (!user) return null
  return (
    <>
      {!open && (
        <button type="button" className="chat-fab" onClick={() => setOpen(true)} aria-label="Open chat" title="Chat">
          <Icon name="chat" size={24} />
          {total > 0 && <span className="chat-fab-badge">{total > 99 ? '99+' : total}</span>}
        </button>
      )}
      {open && (
        <section className={`chat-panel ${activeId ? 'has-active' : ''}`} role="dialog" aria-label="Chat">
          <aside className="chat-side">
            {mode === 'chats' ? (
              <>
                <div className="chat-side-head">
                  <b>Messages</b>
                  <span className="grow" />
                  <button type="button" className={`icon-btn chat-bell ${notifyOn ? 'on' : ''}`} onClick={toggleNotify} aria-label="Desktop notifications"
                    title={notifyOn ? 'Desktop notifications are on (click to turn off)' : 'Turn on desktop notifications'}><Icon name="bell" /></button>
                  <button type="button" className="icon-btn" onClick={() => setMode('people')} aria-label="New chat" title="New chat"><Icon name="userplus" /></button>
                  <button type="button" className="icon-btn" onClick={() => setMode('group')} aria-label="New group" title="New group"><Icon name="users" /></button>
                  <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat" title="Close"><Icon name="x" /></button>
                </div>
                {perm === 'default' && (
                  <button type="button" className="chat-banner" onClick={toggleNotify}><Icon name="bell" size={16} /><span>Get a desktop alert when someone messages you<b>Turn on</b></span></button>
                )}
                <div className="chat-searchbox"><Icon name="search" size={15} /><input placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <div className="chat-list">
                  {convs.isLoading ? <Loading /> : filtered.map((c) => (
                    <button type="button" key={c.id} className={`chat-item ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
                      <ConvAvatar conv={c} />
                      <span className="chat-item-text">
                        <b>{c.name}</b>
                        <small className={c.unread ? 'strong' : ''}>{preview(c.last)}</small>
                      </span>
                      <span className="chat-item-side">
                        <small>{listTime(c.updated_at)}</small>
                        {c.unread > 0 && <span className="chat-count">{c.unread}</span>}
                      </span>
                    </button>
                  ))}
                  {!convs.isLoading && !filtered.length && <p className="muted chat-none">No chats found. Tap the + icon to start one.</p>}
                </div>
              </>
            ) : <People group={mode === 'group'} onBack={() => setMode('chats')} onPick={started} />}
          </aside>
          <div className="chat-main">
            {active ? <Thread key={active.id} conv={active} onBack={() => setActiveId(null)} onLeft={() => setActiveId(null)} /> : (
              <div className="chat-welcome">
                <span className="chat-welcome-icon"><Icon name="chat" size={34} /></span>
                <h3>WorkPilot Chat</h3>
                <p className="muted">Pick a conversation, or start a new one.<br />Share files up to 10 MB by clicking the paperclip or dragging them in.</p>
                <button type="button" className="chat-close-mobile btn light" onClick={() => setOpen(false)}>Close</button>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
