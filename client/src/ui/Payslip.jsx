import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { Loading } from './components'
import { fmtDate, initials, money, monthLabel, rupeesInWords } from './format'
import { useBlob } from './photo'

export function useCompany() {
  return useQuery({ queryKey: ['company'], queryFn: () => api('/company'), staleTime: 60_000 })
}

const Row = ({ label, value, muted }) => (
  <div className={`ps-row ${muted ? 'muted' : ''}`}><span>{label}</span><span>{money(value)}</span></div>
)

const EARN_ROWS = [['basic', 'Basic salary'], ['da', 'Dearness allowance'], ['hra', 'House rent allowance'], ['allowances', 'Special allowance'], ['conveyance', 'Conveyance'], ['travelling_allowance', 'Travelling allowance'], ['medical', 'Medical allowance'], ['other_allowance', 'Other allowances']]
const DED_ROWS = [['pf_employee', 'Provident fund (PF)'], ['esic_employee', 'ESIC'], ['professional_tax', 'Professional tax'], ['tds', 'Income tax (TDS)'], ['other_deductions', 'Loan / other recoveries']]
const ER_ROWS = [['employer_pf', 'Employer PF'], ['employer_edli', 'EDLI'], ['employer_admin', 'PF admin charges'], ['employer_esic', 'Employer ESIC'], ['gratuity_provision', 'Gratuity provision']]

const Fact = ({ label, children }) => <div className="ps-fact"><small>{label}</small><b>{children || '—'}</b></div>

export function PayslipView({ id }) {
  const { data: p, isLoading } = useQuery({ queryKey: ['payslip', id], queryFn: () => api(`/payroll/payslips/${id}`) })
  const { data: co } = useCompany()
  const { url: logo } = useBlob(co?.has_logo ? '/company/logo' : null)
  if (isLoading || !co) return <Loading />

  const e = p.employee
  // Payslips made before the Indian breakup only carry one deductions total.
  const itemised = ['pf_employee', 'esic_employee', 'professional_tax', 'tds', 'other_deductions'].some((k) => Number(p[k]) > 0) || Number(p.employer_cost) > 0
  const accent = co.accent_color || '#4f46e5'
  const paidPct = Math.min(100, Math.round((Number(p.paid_days) / Number(p.total_days || 1)) * 100))
  const contact = [co.phone, co.email, co.website].filter(Boolean)

  return (
    <div className="payslip ps" style={{ '--accent': accent }}>
      <div className="ps-bar" />

      <div className="ps-head">
        <div className="ps-brand">
          {logo ? <img className="ps-logo" src={logo} alt={co.name} /> : <span className="ps-mark">{initials(co.name) || 'HR'}</span>}
          <div>
            <h2>{co.name}</h2>
            {co.tagline && <p className="ps-tag">{co.tagline}</p>}
            {co.address && <p className="ps-addr">{co.address}</p>}
            {contact.length > 0 && <p className="ps-addr">{contact.join('  ·  ')}</p>}
          </div>
        </div>
        <div className="ps-title">
          <small>Salary slip</small>
          <b>{monthLabel(p.month)}</b>
        </div>
      </div>

      <section className="ps-emp">
        <div className="ps-emp-name">
          <span className="ps-avatar">{initials(e.name)}</span>
          <div><b>{e.name}</b><small>{e.designation || '—'}{e.department ? ` · ${e.department}` : ''}</small></div>
        </div>
        <div className="ps-facts">
          <Fact label="Employee ID">{e.emp_code}</Fact>
          <Fact label="Date of joining">{e.join_date && fmtDate(e.join_date)}</Fact>
          <Fact label="Bank account">{e.bank_account}</Fact>
          <Fact label="Loss of pay">{`${Number(p.lop_days)} day(s)`}</Fact>
        </div>
        <div className="ps-days">
          <div className="ps-days-top"><small>Paid days</small><b>{Number(p.paid_days)} <span>of {p.total_days}</span></b></div>
          <div className="ps-track"><div className="ps-fill" style={{ width: `${paidPct}%` }} /></div>
        </div>
      </section>

      <section className="ps-cols">
        <div className="ps-box">
          <h4><i className="ps-dot up" />Earnings</h4>
          {EARN_ROWS.filter(([k]) => k === 'basic' || Number(p[k]) > 0).map(([k, label]) => <Row key={k} label={label} value={p[k]} />)}
          {(p.items || []).filter((i) => i.kind === 'earning').map((i, n) => <Row key={'e' + n} label={i.name} value={i.amount} />)}
          {Number(p.overtime_pay) > 0 && <Row label={`Overtime (${Number(p.overtime_hours)} h)`} value={p.overtime_pay} />}
          <div className="ps-row total"><span>Gross earnings</span><span>{money(p.gross)}</span></div>
        </div>
        <div className="ps-box">
          <h4><i className="ps-dot down" />Deductions</h4>
          {itemised
            ? DED_ROWS.filter(([k]) => Number(p[k]) > 0).map(([k, label]) => <Row key={k} label={label} value={p[k]} />)
            : <Row label="Statutory & other" value={p.deductions} />}
          {(p.items || []).filter((i) => i.kind === 'deduction').map((i, n) => <Row key={'d' + n} label={i.name} value={i.amount} />)}
          {itemised && !DED_ROWS.some(([k]) => Number(p[k]) > 0) && !(p.items || []).some((i) => i.kind === 'deduction') && <Row label="No deductions" value={0} muted />}
          <div className="ps-row total"><span>Total deductions</span><span>{money(p.deductions)}</span></div>
        </div>
      </section>

      {itemised && (
        <section className="ps-employer">
          <h4>Employer contributions <small>(paid by the company, not deducted from your salary)</small></h4>
          <div className="ps-employer-grid">
            {ER_ROWS.filter(([k]) => Number(p[k]) > 0).map(([k, label]) => <div key={k}><small>{label}</small><b>{money(p[k])}</b></div>)}
            <div className="ps-ctc"><small>Monthly cost to company</small><b>{money(p.employer_cost)}</b></div>
          </div>
          {Number(p.statutory_wages) > 0 && <small className="muted">Statutory wages for PF / ESIC / gratuity: {money(p.statutory_wages)}{Number(p.pf_wages) > 0 ? ' · PF wages: ' + money(p.pf_wages) : ''}</small>}
        </section>
      )}

      <section className="ps-net">
        <div>
          <small>Net pay</small>
          <strong>{money(p.net)}</strong>
        </div>
        <p>{rupeesInWords(p.net)}</p>
      </section>

      <footer className="ps-foot">
        <div className="ps-note">
          <p>{co.payslip_footer || 'This is a system-generated payslip. Earnings are pro-rated for unpaid days; PF, ESIC and professional tax are calculated at the statutory rates in force for the month.'}</p>
          {co.tax_id && <small>Reg. / Tax ID: {co.tax_id}</small>}
        </div>
        <div className="ps-sign">
          <span />
          <b>{co.signatory_name || 'Authorised signatory'}</b>
          {co.signatory_title && <small>{co.signatory_title}</small>}
        </div>
      </footer>
    </div>
  )
}
