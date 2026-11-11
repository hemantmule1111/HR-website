import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, download } from '../api'
import { Button, Card, Empty, Loading, PageHeader, Tabs, useToast } from '../ui/components'
import { currentMonth } from '../ui/format'

export default function Reports() {
  const toast = useToast()
  const [tab, setTab] = useState('headcount')
  const [month, setMonth] = useState(currentMonth())
  const [year, setYear] = useState(new Date().getFullYear())
  const query = tab === 'attendance' ? `?month=${month}` : tab === 'leave' ? `?year=${year}` : ''
  const { data, isLoading, isFetching } = useQuery({ queryKey: ['report', tab, query], queryFn: () => api(`/reports/${tab}${query}`) })
  return (
    <>
      <PageHeader title="Reports" subtitle="Workforce analytics you can export">
        <Button variant="ghost" icon="download" disabled={!data} onClick={() => download(`/reports/${tab}${query}${query ? '&' : '?'}format=csv`, `${data.name}.csv`).catch((e) => toast(e.message, 'error'))}>Export CSV</Button>
      </PageHeader>
      <Tabs tabs={[{ id: 'headcount', label: 'Headcount' }, { id: 'attendance', label: 'Attendance' }, { id: 'leave', label: 'Leave utilization' }]} value={tab} onChange={setTab} />
      <div className="toolbar">
        {tab === 'attendance' && <input className="input" style={{ width: 'auto' }} type="month" max={currentMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
        {tab === 'leave' && <input className="input" style={{ width: 120 }} type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(Number(e.target.value))} />}
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.rows.length ? <Empty icon="chart" title="No data for this selection" /> : (
          <div className="table-wrap" style={{ opacity: isFetching ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr>{data.columns.map((c, i) => <th key={c.key} className={i > 2 || (tab === 'headcount' && i > 0) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{data.rows.map((r, ri) => (
                <tr key={ri}>{data.columns.map((c, i) => <td key={c.key} className={i > 2 || (tab === 'headcount' && i > 0) ? 'num' : ''}>{r[c.key] === '' ? '—' : r[c.key]}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
