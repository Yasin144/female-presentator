export const OTA_RELEASES = Object.freeze([
  Object.freeze({
    mode: 'salary', directory: 'ota', version: '8.2.37',
    buildId: 'ota_8_2_37_datewise_expense_exports',
    bundleName: 'app-bundle-8.2.37', manifestFile: 'ota-manifest.json',
    notes: 'v8.2.37: Export completed expenses for one date, a date range or all dates. Prepare date-wise WhatsApp messages, copy a table for Excel, or download an Excel workbook in supported browsers. Direct Android .xlsx saving needs the signed APK update. Income and refunds are excluded; existing records and calculations are preserved.',
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
