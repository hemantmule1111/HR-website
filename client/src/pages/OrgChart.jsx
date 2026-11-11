import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import { Avatar, Button, Empty, Loading, PageHeader } from '../ui/components'
import { hueFor } from '../ui/format'

const deptColor = (d) => `hsl(${hueFor(d || 'none')} 68% 50%)`

function Branch({ node, kids, onOpen, active }) {
  const children = kids.get(node.id) || []
  const dim = active && active !== (node.department || '—')
  return (
    <li>
      <button className={`node ${dim ? 'dim' : ''}`} style={{ '--dept': deptColor(node.department) }} onClick={() => onOpen(node)} title={`${node.name} · ${node.department || 'No department'}`}>
        <Avatar name={node.name} size={34} />
        <b>{node.name}</b>
        <small>{node.designation || node.emp_code}</small>
        {children.length > 0 && <span className="node-count">{children.length}</span>}
      </button>
      {children.length > 0 && <ul>{children.map((c) => <Branch key={c.id} node={c} kids={kids} onOpen={onOpen} active={active} />)}</ul>}
    </li>
  )
}

export default function OrgChart() {
  const nav = useNavigate()
  const { can } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['org-tree'], queryFn: () => api('/employees/tree') })
  const box = useRef(null)
  const inner = useRef(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const [fit, setFit] = useState(1)
  const [zoom, setZoom] = useState(null) // null = auto-fit to the window
  const [active, setActive] = useState(null)

  useLayoutEffect(() => {
    if (!box.current || !inner.current) return undefined
    const calc = () => {
      const w = inner.current.scrollWidth, h = inner.current.scrollHeight
      setSize({ w, h })
      setFit(Math.max(0.3, Math.min(1, (box.current.clientWidth - 32) / w, (box.current.clientHeight - 32) / h)))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(box.current)
    ro.observe(inner.current)
    return () => ro.disconnect()
  }, [data])

  const { kids, roots, depts } = useMemo(() => {
    const k = new Map()
    for (const n of data || []) k.set(n.manager_id, [...(k.get(n.manager_id) || []), n])
    const ids = new Set((data || []).map((n) => n.id))
    const counts = {}
    for (const n of data || []) counts[n.department || '—'] = (counts[n.department || '—'] || 0) + 1
    return { kids: k, roots: (data || []).filter((n) => !n.manager_id || !ids.has(n.manager_id)), depts: Object.entries(counts) }
  }, [data])

  if (isLoading) return <Loading />
  const scale = zoom ?? fit
  const step = (d) => setZoom(Math.min(1.6, Math.max(0.3, +(scale + d).toFixed(2))))

  return (
    <div className="org-page">
      <PageHeader title="Org chart" subtitle={`${data.length} people · ${depts.length} departments`}>
        <Button variant="ghost" className="sm" icon="minus" onClick={() => step(-0.1)} aria-label="Zoom out" />
        <span className="org-zoom">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" className="sm" icon="plus" onClick={() => step(0.1)} aria-label="Zoom in" />
        <Button variant="ghost" className="sm" icon="fit" onClick={() => setZoom(null)}>Fit</Button>
      </PageHeader>

      <div className="org-legend">
        {depts.map(([d, n]) => (
          <button key={d} type="button" className={`org-chip ${active === d ? 'on' : ''}`} style={{ '--dept': deptColor(d === '—' ? null : d) }} onClick={() => setActive(active === d ? null : d)}>
            <i />{d} <small>{n}</small>
          </button>
        ))}
      </div>

      <div className="org-stage" ref={box}>
        {!roots.length ? <Empty icon="sitemap" title="No employees yet" /> : (
          <div className="org-sizer" style={{ width: size.w * scale, height: size.h * scale }}>
            <div className="org" ref={inner} style={{ transform: `scale(${scale})` }}>
              <ul>{roots.map((r) => <Branch key={r.id} node={r} kids={kids} active={active} onOpen={(n) => can('employee.view') && nav(`/employees/${n.id}`)} />)}</ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
