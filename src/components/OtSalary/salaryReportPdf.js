import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { salaryMoney } from './salaryReport.js';

export async function salaryReportPdf(report, fontBytes) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let font = 'helvetica';
  if (fontBytes) {
    const bytes = new Uint8Array(fontBytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const encoded = typeof btoa === 'function' ? btoa(binary) : globalThis.Buffer.from(bytes).toString('base64');
    doc.addFileToVFS('Nunito.ttf', encoded); doc.addFont('Nunito.ttf', 'Nunito', 'normal');
    doc.addFont('Nunito.ttf', 'Nunito', 'bold'); font = 'Nunito';
  }
  doc.setFont(font); doc.setTextColor(8, 95, 72); doc.setFontSize(18); doc.text('TIME IS MONEY', 14, 18);
  doc.setFontSize(13); doc.text(`Monthly payslip | ${report.monthLabel}`, 14, 26);
  const employeeLines = doc.splitTextToSize(`Employee: ${report.employee}`, 180);
  doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.text(employeeLines, 14, 34);
  autoTable(doc, { startY: 39 + (employeeLines.length - 1) * 5, head: [['Pay summary', 'Amount (INR)']],
    body: report.totals.map(([label, amount]) => [label, salaryMoney(amount)]), theme: 'striped',
    styles: { font, fontSize: 10, cellPadding: 3 }, headStyles: { fillColor: [8, 127, 91] }, columnStyles: { 1: { halign: 'right' } },
    didParseCell: data => { if (data.section === 'body' && data.row.index === 5) data.cell.styles.fillColor = [209, 250, 229]; } });
  autoTable(doc, { startY: doc.lastAutoTable.finalY + 5, body: [
    ['Salary cycle', report.salaryCycle.replace(/–/g, '-')], ['Overtime cycle', report.overtimeCycle.replace(/–/g, '-')], ['Saved attendance', `${report.savedDays} days`],
    ['Personal expenses (not deducted)', salaryMoney(report.expenseTotal)], ['About this report', report.note]],
    styles: { font, fontSize: 8.5, cellPadding: 2.5 }, theme: 'plain' });
  autoTable(doc, { startY: doc.lastAutoTable.finalY + 7, head: [['Date', 'Saved', 'Status', 'IN / OUT', 'OT min', 'Day pay (INR)', 'Note']],
    body: report.attendance.map(row => [row.date, row.saved ? 'Yes' : 'Estimate', row.status, `${row.inTime || '-'} / ${row.outTime || '-'}`, String(row.otMins), salaryMoney(row.total), row.note]),
    styles: { font, fontSize: 7, cellPadding: 2, overflow: 'linebreak' }, headStyles: { fillColor: [8, 127, 91] },
    columnStyles: { 0: { cellWidth: 22 }, 5: { halign: 'right' } }, margin: { top: 15, bottom: 15 }, rowPageBreak: 'avoid' });
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text(`Time Is Money | ${report.monthLabel} | Page ${page} of ${doc.getNumberOfPages()}`, 14, 289);
  }
  return doc.output('arraybuffer');
}
