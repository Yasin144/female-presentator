export const OTA_RELEASES = Object.freeze([
  Object.freeze({
    mode: 'salary', directory: 'ota', version: '8.2.35',
    buildId: 'ota_8_2_35_bounded_transactions_live_ot',
    bundleName: 'app-bundle-8.2.35', manifestFile: 'ota-manifest.json',
    notes: 'v8.2.35: Transactions stay in a bounded scroll panel and preserve your reading position. Today attendance and the live OT timer have a refreshed layout, and calendar overtime values show time digits without the OT label. Existing records, calculations and biometric protection are preserved.',
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
