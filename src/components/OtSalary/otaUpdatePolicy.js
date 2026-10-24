export const isValidOtaVersion = (value) => typeof value === 'string' && value.trim() === value && value.length <= 40 && /^[0-9]{1,9}(\.[0-9]{1,9}){0,4}$/.test(value);
export const isValidOtaBuild = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._-]+$/.test(value);

export function compareOtaVersions(first, second) {
  if (!isValidOtaVersion(first) || !isValidOtaVersion(second)) throw new TypeError('Invalid app version');
  const left = first.split('.').map(Number);
  const right = second.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

// A native status is authoritative even when its build ID is deliberately empty
// after an APK update. Old browser metadata must not impersonate an active OTA.
export function resolveInstalledOtaStatus({ nativeStatus, storedVersion = '', storedBuild = '', builtinVersion }) {
  if (nativeStatus && typeof nativeStatus === 'object') {
    const version = [nativeStatus.activeVersion, nativeStatus.version, nativeStatus.builtinVersion].find(isValidOtaVersion);
    if (version) {
      const hasBundle = nativeStatus.hasOtaBundle !== false && nativeStatus.hasLiveBundle !== false;
      return { version, buildId: hasBundle && isValidOtaBuild(nativeStatus.buildId) ? nativeStatus.buildId : '' };
    }
  }
  return {
    version: isValidOtaVersion(storedVersion) ? storedVersion : builtinVersion,
    buildId: isValidOtaVersion(storedVersion) && isValidOtaBuild(storedBuild) ? storedBuild : '',
  };
}

export function isOtaUpdateAvailable(version, buildId, installed) {
  if (!isValidOtaVersion(version) || !isValidOtaBuild(buildId) || !isValidOtaVersion(installed?.version)) return false;
  const comparison = compareOtaVersions(version, installed.version);
  return comparison > 0 || (comparison === 0 && Boolean(installed.buildId) && buildId !== installed.buildId);
}
