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

export const LEAD_COMMUNITY_NAME_MAX = 160;

export function communityNameFromAppointment(input: {
  locationName?: string | null;
  address?: string | null;
}) {
  const fromLocation = String(input.locationName || '').trim().slice(0, LEAD_COMMUNITY_NAME_MAX);
  if (fromLocation) return fromLocation;
  return String(input.address || '').trim().slice(0, LEAD_COMMUNITY_NAME_MAX);
}

export type AppointmentLocationInput = {
  locationName: string;
  latitude: string;
  longitude: string;
  coordinateSystem: 'gcj02';
};

export function parseAppointmentLocation(value: unknown): AppointmentLocationInput | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError('地图位置无效', 400);
  }
  const location = value as Record<string, unknown>;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const locationName = typeof location.locationName === 'string' ? location.locationName.trim() : '';
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw httpError('地图坐标无效，请重新选择地点', 400);
  }
  if (locationName.length > 200) throw httpError('地图地点名称不能超过 200 字', 400);
  if (location.coordinateSystem !== 'gcj02') {
    throw httpError('仅支持微信地图 GCJ-02 坐标', 400);
  }
  return {
    locationName,
    latitude: latitude.toFixed(7),
    longitude: longitude.toFixed(7),
    coordinateSystem: 'gcj02',
  };
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
    locationName: record.locationName,
    latitude: record.latitude == null ? null : Number(record.latitude),
    longitude: record.longitude == null ? null : Number(record.longitude),
    coordinateSystem: record.coordinateSystem,
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
