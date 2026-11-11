import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import Icon from '../ui/Icon'
import { Badge, Button, Empty, Loading, Modal, PageHeader } from '../ui/components'
import { money, monthLabel } from '../ui/format'
import { PayslipView } from './Payroll'

export default function Payslips() {
  const [open, setOpen] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['my-payslips'], queryFn: () => api('/payroll/payslips') })
  if (isLoading) return <Loading />
  return (
    <>
      <PageHeader title="My payslips" subtitle="Download or print your salary slips" />
      {!data.length ? <div className="card"><Empty icon="wallet" title="No payslips yet" hint="They appear here once payroll for a month is approved." /></div> : (
        <div className="grid g3">
          {data.map((p) => (
            <button key={p.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', padding: '1.3rem' }} onClick={() => setOpen(p.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="stat-icon indigo"><Icon name="file" /></span><Badge status={p.status}>{p.status}</Badge>
              </div>
              <h3 style={{ marginTop: '1rem' }}>{monthLabel(p.month)}</h3>
              <p className="muted">Net pay</p>
              <strong style={{ fontSize: '1.6rem', letterSpacing: '-.03em' }}>{money(p.net)}</strong>
            </button>
          ))}
        </div>
      )}
      {open && (
        <Modal wide title="Payslip" onClose={() => setOpen(null)}>
          <PayslipView id={open} />
          <div className="form-actions no-print"><Button icon="printer" onClick={() => window.print()}>Print / Save as PDF</Button></div>
        </Modal>
      )}
    </>
  )
}
