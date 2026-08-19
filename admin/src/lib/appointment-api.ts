import type { AppointmentRecord } from '@/db/repositories';
import { httpError } from '@/lib/http-error';

export function parseAppointmentId(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!/^[1-9]\d*$/.test(text)) throw httpError(`${label}无效`, 400);
  return BigInt(text);
}

export function parseAppointmentDateTime(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw httpError(`${label}必填`, 400);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(`${label}无效`, 400);
  return date;
}

export function parseAppointmentVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw httpError('预约版本无效', 400);
  return version;
}

export function parseAppointmentAddress(value: unknown) {
  const address = typeof value === 'string' ? value.trim() : '';
  if (!address || address.length > 300) throw httpError('请填写不超过 300 字的上门地址', 400);
  return address;
}

export function appointmentToDto(
  record: AppointmentRecord,
  customerContact?: { name?: string | null; phone?: string | null }
) {
  return {
    id: record.id.toString(),
    enterpriseId: record.enterpriseId.toString(),
    leadId: record.leadId.toString(),
    designerId: record.designerId.toString(),
    measurerId: record.measurerId.toString(),
    address: record.address,
    timeRange: record.timeRange,
    status: record.status,
    version: record.version,
    updatedByUserId: record.updatedByUserId?.toString() ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    // Only the authenticated measurer's calendar supplies this optional
    // contact. Other appointment callers keep the existing appointment-only
    // payload and their current privacy boundary.
    ...(customerContact ? {
      customerName: customerContact.name || '客户',
      customerPhone: customerContact.phone || '',
    } : {}),
  };
}
