export function updateAlertBridge(host, method) {
  return [host?.PattanBiometric, host?.PattanBiometricBridge].find(bridge => typeof bridge?.[method] === 'function');
}

export function readUpdateAlertStatus(host) {
  const bridge = updateAlertBridge(host, 'getUpdateAlertStatusJson');
  if (!bridge) return { supported: false };
  const value = JSON.parse(bridge.getUpdateAlertStatusJson());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Android returned an invalid alert status.');
  return value;
}
