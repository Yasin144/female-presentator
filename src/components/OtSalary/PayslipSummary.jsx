import React from 'react';
import './PayslipSummary.css';

export default function PayslipSummary({ report, formatMoney }) {
  return <section className="payslip-summary" aria-label="Payslip earnings and deductions">
    <div className="payslip-summary-totals">
      <div><span>Full earnings</span><strong>{formatMoney(report.totals[3][1])}</strong><small>Before leave deductions</small></div>
      <div className="payslip-summary-net"><span>Net receivable</span><strong>{formatMoney(report.totals[5][1])}</strong><small>After leave deductions</small></div>
    </div>
    <dl>{report.totals.filter((_, i) => [0, 1, 2, 4, 6].includes(i)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label.startsWith('Leave') ? '− ' : ''}{formatMoney(value)}</dd></div>)}</dl>
    <p>Full-month summary · {report.savedDays} saved attendance records.<br />Personal expenses and payment credits are tracked separately.</p>
  </section>;
}
