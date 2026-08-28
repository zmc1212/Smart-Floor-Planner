const MAX_SERIAL_NUMBER_LENGTH = 64;

export function compactDeviceIdentity(value?: string | null) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

export function matchesDeviceSerialNumber(stored: unknown, query: unknown) {
  const needle = compactDeviceIdentity(
    typeof query === 'string' ? query : ''
  );
  if (!needle) return true;
  const haystack = compactDeviceIdentity(
    typeof stored === 'string' ? stored : ''
  );
  return haystack.includes(needle);
}

export function normalizeDeviceSerialNumber(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('SN 码格式无效');
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.length > MAX_SERIAL_NUMBER_LENGTH) {
    throw new Error('SN 码不能超过 64 个字符');
  }
  return normalized;
}

export function postgresConstraintName(error: unknown) {
  const details = error as {
    constraint?: string;
    cause?: { constraint?: string };
  };
  return details.constraint ?? details.cause?.constraint ?? '';
}

export function duplicateDeviceMessage(
  error: unknown,
  options: { createCopy?: boolean; enrollment?: boolean } = {}
) {
  const constraint = postgresConstraintName(error);
  if (constraint.includes('serial_number')) {
    return '设备 SN 码已存在';
  }
  if (options.enrollment) {
    return '该设备已录入';
  }
  return options.createCopy
    ? '设备编码已存在，请在列表中编辑该设备'
    : '设备编码已存在';
}
