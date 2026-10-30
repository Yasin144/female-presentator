import React, { useRef, useState } from 'react';

export default function WhatsAppReportRecovery({ report, onRetry, onDismiss }) {
  const textRef = useRef(null);
  const [copyStatus, setCopyStatus] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.text);
      setCopyStatus('Full report copied. Paste it into WhatsApp, then review and send.');
    } catch (_) {
      textRef.current?.focus();
      textRef.current?.select();
      setCopyStatus('Select Copy from the text menu, then paste the full report into WhatsApp.');
    }
  };
  return (
    <section className="tim-whatsapp-report" aria-label="Prepared WhatsApp report">
      <div className="tim-whatsapp-report-heading">
        <strong>WhatsApp report ready</strong>
        <button type="button" onClick={onDismiss} aria-label="Dismiss prepared WhatsApp report">×</button>
      </div>
      <p>{report.status === 'failed' ? 'WhatsApp could not open. ' : ''}{report.phone === 'PICK_CONTACT' ? 'Choose your recipient, then review and send in WhatsApp.' : 'Review and send to +91 7386726193 in WhatsApp.'} If its message box is empty, copy the full report below.</p>
      <details>
        <summary>View full {report.direction.toUpperCase()} report · {report.text.length} characters</summary>
        <textarea ref={textRef} readOnly value={report.text} aria-label="Full WhatsApp attendance report" />
      </details>
      <div className="tim-whatsapp-report-actions">
        <button type="button" onClick={copy}>Copy full report</button>
        <button type="button" onClick={onRetry}>Open WhatsApp again</button>
      </div>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </section>
  );
}
