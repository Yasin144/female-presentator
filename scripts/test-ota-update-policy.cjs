const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const policy = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/otaUpdatePolicy.js')));
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks += 1; };
  equal(policy.compareOtaVersions('8.2.100', '8.2.33'), 1);
  equal(policy.compareOtaVersions('8.10', '8.2.33'), 1);
  equal(policy.compareOtaVersions('8.2.33.0', '8.2.33'), 0);
  equal(policy.compareOtaVersions('8.2.3', '8.2.33'), -1);
  for (const version of ['', 'eight', '8..2', '8.2.33-beta', '99999999999', '1.2.3.4.5.6', '8.2.33\n', null]) {
    equal(policy.isValidOtaVersion(version), false);
  }
  for (const build of ['', '../unsafe', 'build with spaces', 'x'.repeat(161), null]) equal(policy.isValidOtaBuild(build), false);
  equal(policy.isValidOtaBuild('ota_8_2_34_release'), true);
  const builtin = { version: '8.2.33', buildId: '' };
  equal(policy.isOtaUpdateAvailable('8.2.34', 'new', builtin), true);
  equal(policy.isOtaUpdateAvailable('8.2.32', 'different', builtin), false);
  equal(policy.isOtaUpdateAvailable('8.2.33', 'different', builtin), false);
  const active = { version: '8.2.33', buildId: 'current' };
  equal(policy.isOtaUpdateAvailable('8.2.33', 'current', active), false);
  equal(policy.isOtaUpdateAvailable('8.2.33', 'hotfix', active), true);
  equal(policy.isOtaUpdateAvailable('8.2.33.0', 'hotfix', active), true);
  equal(policy.isOtaUpdateAvailable('8.2.32', 'older-hotfix', active), false);
  equal(policy.isOtaUpdateAvailable('bad', 'current', active), false);
  equal(policy.resolveInstalledOtaStatus({nativeStatus: {activeVersion: '8.2.34', buildId: 'native'}, storedVersion: '8.2.32', storedBuild: 'stale', builtinVersion: '8.2.33'}), {version: '8.2.34', buildId: 'native'});
  equal(policy.resolveInstalledOtaStatus({nativeStatus: {activeVersion: '8.2.33', buildId: '', hasOtaBundle: false}, storedVersion: '8.2.32', storedBuild: 'stale', builtinVersion: '8.2.33'}), builtin);
  equal(policy.resolveInstalledOtaStatus({nativeStatus: {version: '1.0.10', buildId: 'legacy', hasLiveBundle: true}, builtinVersion: '1.0.10'}), {version: '1.0.10', buildId: 'legacy'});
  equal(policy.resolveInstalledOtaStatus({storedVersion: '8.2.34', storedBuild: 'web', builtinVersion: '8.2.33'}), {version: '8.2.34', buildId: 'web'});
  equal(policy.resolveInstalledOtaStatus({storedVersion: '', storedBuild: 'orphan', builtinVersion: '8.2.33'}), builtin);
  console.log(`OTA update policy: ${checks} scenarios passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
