// A handoff prepares a draft; only WhatsApp can send it after the user's review.
export function openWhatsAppReport(host, phone, text) {
  if (!host || typeof text !== 'string' || !text.trim()) return { status: 'failed' };
  const pickContact = !phone || phone === 'PICK_CONTACT';
  const nativePhone = pickContact ? 'PICK_CONTACT' : phone;
  const bridges = [host.PattanBiometric, host.PattanBiometricBridge, host.PattanSecureWhatsApp]
    .filter((bridge, index, all) => bridge && all.indexOf(bridge) === index);
  // The native text-sharing path carries the report in EXTRA_TEXT rather than
  // relying on WhatsApp restoring a pre-filled deep link after biometric login.
  for (const method of ['shareWhatsAppMessageToNumber', 'sendWhatsAppMessageToNumber']) {
    for (const bridge of bridges) {
      if (typeof bridge[method] !== 'function') continue;
      try {
        if (bridge[method](nativePhone, text) !== false) return { status: 'opening', method };
      } catch (_) { /* Try another supported bridge, retaining the same text. */ }
    }
  }
  try {
    const url = `https://api.whatsapp.com/send?${pickContact ? '' : `phone=${encodeURIComponent(phone)}&`}text=${encodeURIComponent(text)}`;
    // Mobile navigation survives the user-activation loss after biometric auth.
    if (/Android|iPhone|iPad|iPod/i.test(host.navigator?.userAgent || '')) {
      host.location.href = url;
      return { status: 'opening', method: 'link' };
    }
    const popup = host.open(url, '_blank');
    if (!popup) return { status: 'failed' };
    try { popup.opener = null; } catch (_) {}
    return { status: 'opening', method: 'link' };
  } catch (_) { return { status: 'failed' }; }
}
