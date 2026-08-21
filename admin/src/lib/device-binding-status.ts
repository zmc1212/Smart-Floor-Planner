export type DeviceBindingStatus =
  | 'unassigned'
  | 'assigned'
  | 'maintenance'
  | 'lost';

/** Normalize status from enterprise ownership (not staff bindings). */
export function normalizeDeviceBindingStatus(
  status: DeviceBindingStatus,
  hasEnterprise: boolean
): DeviceBindingStatus {
  if (hasEnterprise && status === 'unassigned') return 'assigned';
  if (!hasEnterprise && status === 'assigned') return 'unassigned';
  return status;
}
