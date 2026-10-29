import { fail } from '@/lib/assistant/contracts';
import { text } from './contracts';

// Managed cloud-site service orders. Fees and deposits are recorded for an
// offline settlement; this module never initiates or verifies a payment.
export const serviceOrderStatuses = ['pending_quote', 'quoted', 'confirmed', 'scheduled', 'accepted', 'exited', 'cancelled'] as const;
export type ServiceOrderStatus = typeof serviceOrderStatuses[number];
export const servicePointStatuses = ['pending', 'installed', 'accepted'] as const;
export const repairStatuses = ['open', 'resolved', 'cancelled'] as const;
export const MAX_SERVICE_CAMERAS = 8;
export const MAX_SERVICE_CENTS = 100000000000;
export type QuoteLine = { label: string; amountCents: number };
export type ServicePointInput = { name: string; roomId: string | null; positionNote: string };

const integer = (value: unknown, min: number, max: number) => {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail('invalid_service_order', 422);
  return Number(value);
};
const words = (value: unknown, max: number, required = true) => {
  try { return text(value, max, required); } catch { fail('invalid_service_order', 422); }
};
export const cameraCount = (value: unknown) => integer(value, 1, MAX_SERVICE_CAMERAS);
export const retentionDays = (value: unknown) => integer(value, 1, 30);
export const serviceDays = (value: unknown) => integer(value, 1, 3650);
export function money(value: unknown) {
  return integer(value, 0, MAX_SERVICE_CENTS);
}
export function quoteLines(value: unknown): { lines: QuoteLine[]; totalCents: number } {
  if (!Array.isArray(value) || !value.length || value.length > 10) fail('invalid_service_order', 422);
  const lines = value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('invalid_service_order', 422);
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some(name => !['label', 'amountCents'].includes(name))) fail('invalid_service_order', 422);
    return { label: words(item.label, 40), amountCents: money(item.amountCents) };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_SERVICE_CENTS) fail('invalid_service_order', 422);
  return { lines, totalCents };
}
export function servicePoints(value: unknown): ServicePointInput[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SERVICE_CAMERAS) fail('invalid_service_order', 422);
  const points = value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('invalid_service_order', 422);
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).some(name => !['name', 'roomId', 'positionNote'].includes(name))) fail('invalid_service_order', 422);
    if (item.roomId !== undefined && item.roomId !== null && item.roomId !== '') {
      if (typeof item.roomId !== 'string' || !/^[1-9]\d{0,18}$/.test(item.roomId)) fail('invalid_service_order', 422);
    }
    return { name: words(item.name, 40), roomId: item.roomId ? String(item.roomId) : null, positionNote: words(item.positionNote ?? '', 200, false) };
  });
  if (new Set(points.map(point => point.name)).size !== points.length) fail('invalid_service_order', 422);
  return points;
}
export const extensionDays = (value: unknown) => integer(value, 1, 3650);
export const repairIssue = (value: unknown) => words(value, 500);
export const repairResolution = (value: unknown) => words(value, 200);
export function depositDisposition(value: Record<string, unknown>) {
  const returnedCents = money(value.depositReturnedCents), deductedCents = money(value.depositDeductedCents);
  const note = words(value.depositNote ?? '', 200, false);
  return { returnedCents, deductedCents, note };
}
export function shanghaiDayStart(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date) - 8 * 3600 * 1000);
}
export function scheduledFor(value: unknown, now = new Date()) {
  if (typeof value !== 'string' || value.length > 40) fail('invalid_service_order', 422);
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) fail('invalid_service_order', 422);
  if (at < shanghaiDayStart(now)) fail('service_order_schedule_past', 422);
  if (at > new Date(now.getTime() + 366 * 86400000)) fail('invalid_service_order', 422);
  return at.toISOString();
}
export const canQuote = (status: string) => status === 'pending_quote' || status === 'quoted' || status === 'confirmed';
export const canConfirm = (status: string) => status === 'quoted';
export const canSchedule = (status: string) => status === 'confirmed' || status === 'scheduled';
export const canCancel = (status: string) => status !== 'accepted' && status !== 'exited' && status !== 'cancelled';
export const canActOnPoint = (status: string) => status === 'scheduled';
export const canRepair = (status: string) => status === 'scheduled' || status === 'accepted';
export const canExtend = (status: string) => status === 'accepted';
export const canExit = (status: string) => status === 'accepted';
export const allPointsAccepted = (points: Array<{ status: string }>) => points.length > 0 && points.every(point => point.status === 'accepted');
export const cents = (value: unknown) => {
  // pg returns int8 columns as decimal strings, so a stored receipt may arrive as text.
  const amount = typeof value === 'bigint' || typeof value === 'number' ? Number(value)
    : typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
};
export const orderDate = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
