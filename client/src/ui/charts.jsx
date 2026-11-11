import { useId } from 'react'

export const PALETTE = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

export function Ring({ value, max, size = 76, stroke = 8, color = '#6366f1', children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .8s ease' }}
        />
      </svg>
      <span className="ring-label">{children}</span>
    </div>
  )
}

export function Donut({ data, size = 170, thickness = 26, center }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="donut-wrap">
      <div className="ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
          {total > 0 && data.map((d, i) => {
            const len = (d.value / total) * c
            const el = (
              <circle key={d.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color || PALETTE[i % PALETTE.length]}
                strokeWidth={thickness} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{`${d.name}: ${d.value}`}</title></circle>
            )
            offset += len
            return el
          })}
        </svg>
        <span className="ring-label donut-center">{center}</span>
      </div>
      <ul className="legend">
        {data.map((d, i) => (
          <li key={d.name}><i style={{ background: d.color || PALETTE[i % PALETTE.length] }} />{d.name}<b>{d.value}</b></li>
        ))}
      </ul>
    </div>
  )
}

// Smooth area line chart. data: [{label, value}]
export function AreaChart({ data, height = 180, color = '#6366f1' }) {
  const gid = useId().replace(/:/g, '')
  const W = 600
  const pad = { l: 28, r: 10, t: 14, b: 26 }
  const max = Math.max(1, ...data.map((d) => d.value))
  const niceMax = Math.ceil(max / 2) * 2 || 2
  const x = (i) => pad.l + (data.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (data.length - 1))
  const y = (v) => height - pad.b - (v / niceMax) * (height - pad.t - pad.b)
  const pts = data.map((d, i) => [x(i), y(d.value)])
  const line = pts.map((p, i) => {
    if (i === 0) return `M${p[0]},${p[1]}`
    const prev = pts[i - 1]
    const cx = (prev[0] + p[0]) / 2
    return `C${cx},${prev[1]} ${cx},${p[1]} ${p[0]},${p[1]}`
  }).join(' ')
  const area = pts.length ? `${line} L${pts.at(-1)[0]},${height - pad.b} L${pts[0][0]},${height - pad.b} Z` : ''
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(niceMax * t)} y2={y(niceMax * t)} stroke="var(--line)" strokeDasharray="4 5" />
          <text x={pad.l - 6} y={y(niceMax * t) + 4} textAnchor="end" className="axis">{Math.round(niceMax * t)}</text>
        </g>
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="4" fill="var(--surface)" stroke={color} strokeWidth="2.5"><title>{`${data[i].label}: ${data[i].value}`}</title></circle>
          {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && <text x={p[0]} y={height - 7} textAnchor="middle" className="axis">{data[i].label}</text>}
        </g>
      ))}
    </svg>
  )
}

// Grouped bars. series: [{key,label,color}]
export function BarChart({ data, series, height = 200 }) {
  const W = 380
  const pad = { l: 28, r: 10, t: 14, b: 26 }
  const max = Math.max(2, ...data.flatMap((d) => series.map((s) => d[s.key])))
  const groupW = (W - pad.l - pad.r) / data.length
  const barW = Math.min(26, (groupW - 14) / series.length)
  const y = (v) => height - pad.b - (v / max) * (height - pad.t - pad.b)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label="Bar chart">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeDasharray="4 5" />
            <text x={pad.l - 6} y={y(max * t) + 4} textAnchor="end" className="axis">{Math.round(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const gx = pad.l + i * groupW + (groupW - barW * series.length - 4 * (series.length - 1)) / 2
          return (
            <g key={d.label}>
              {series.map((s, j) => (
                <rect key={s.key} x={gx + j * (barW + 4)} y={y(d[s.key])} width={barW} height={Math.max(0, height - pad.b - y(d[s.key]))} rx="6" fill={s.color}>
                  <title>{`${s.label}: ${d[s.key]}`}</title>
                </rect>
              ))}
              <text x={pad.l + i * groupW + groupW / 2} y={height - 7} textAnchor="middle" className="axis">{d.label}</text>
            </g>
          )
        })}
      </svg>
      <ul className="legend inline">
        {series.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>)}
      </ul>
    </div>
  )
}

export function HBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="hbars">
      {data.map((d, i) => (
        <li key={d.name}>
          <span>{d.name}</span>
          <div><i style={{ width: `${(d.value / max) * 100}%`, background: d.color || PALETTE[i % PALETTE.length] }} /></div>
          <b>{d.value}</b>
        </li>
      ))}
    </ul>
  )
}
