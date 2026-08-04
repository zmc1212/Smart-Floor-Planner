export type DeviceBindingStatus =
  | 'unassigned'
  | 'assigned'
  | 'maintenance'
  | 'lost';

export function normalizeDeviceBindingStatus(
  status: DeviceBindingStatus,
  hasAssignedUser: boolean,
  hasEnterprise: boolean
): DeviceBindingStatus {
  if (hasAssignedUser && status === 'unassigned') return 'assigned';
  if (!hasAssignedUser && !hasEnterprise && status === 'assigned') {
    return 'unassigned';
  }
  return status;
}
