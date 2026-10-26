export const OTA_RELEASES = Object.freeze([
  Object.freeze({
    mode: 'salary', directory: 'ota', version: '8.2.36',
    buildId: 'ota_8_2_36_whatsapp_report_recovery',
    bundleName: 'app-bundle-8.2.36', manifestFile: 'ota-manifest.json',
    notes: 'v8.2.36: Keep the full IN/OUT WhatsApp report available with Copy and Retry when WhatsApp opens empty. Punch notices now say report ready rather than sent. Existing attendance, expenses and calculations are preserved. Full-text native sharing and screen-off spoken alerts still require the compatible signed APK.',
  }),
  Object.freeze({
    mode: 'udhaar', directory: 'ota-udhaar', version: '1.0.11',
    buildId: 'udhaar_ota_1_0_11_time_is_money_transactions',
    bundleName: 'udhaar-bundle-1.0.11', manifestFile: 'udhaar-ota-manifest.json',
    notes: 'v1.0.11: Updated Udhaar Book interface and transaction details with existing biometric protection and records preserved. Background update controls require a compatible Android APK.',
  }),
]);

export function otaReleaseFor(mode) {
  const release = OTA_RELEASES.find(item => item.mode === mode);
  if (!release) throw new Error('OTA app must be salary or udhaar.');
  return { ...release, jsFile: `${release.bundleName}.js`, cssFile: `${release.bundleName}.css` };
}
