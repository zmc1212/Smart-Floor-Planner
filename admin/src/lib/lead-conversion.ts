import type { LeadWithRelations } from '@/db/repositories';
import { httpError } from '@/lib/http-error';
import { normalizeLeadStatus } from '@/lib/lead-status';

const CONVERTIBLE_STATUSES = new Set(['new', 'measuring', 'designing']);
type ConversionLead = Pick<
  LeadWithRelations,
  'assignedTo' | 'archivedAt' | 'status'
>;

function chinaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function canMarkLeadConverted(
  lead: ConversionLead,
  role: string,
  actorId: bigint
) {
  if (lead.archivedAt) return false;
  const normalized = normalizeLeadStatus(lead.status);
  if (!CONVERTIBLE_STATUSES.has(normalized)) return false;
  if (role === 'enterprise_admin') return true;
  return role === 'designer' && lead.assignedTo === actorId;
}

export function canRevertLeadConversion(lead: ConversionLead, role: string) {
  return (
    !lead.archivedAt &&
    role === 'enterprise_admin' &&
    normalizeLeadStatus(lead.status) === 'converted'
  );
}

export function getLeadConversionActions(
  lead: ConversionLead,
  role: string,
  actorId: bigint | null
) {
  return {
    canMarkConverted: actorId
      ? canMarkLeadConverted(lead, role, actorId)
      : false,
    canRevertConversion: canRevertLeadConversion(lead, role),
  };
}

export function hasLeadConversionEnterpriseContext(
  miniEnterpriseId?: string | null,
  adminEnterpriseId?: string | null
) {
  return Boolean(miniEnterpriseId || adminEnterpriseId);
}

export function redactLeadConversionDetailsForConsumer<
  T extends {
    convertedAt: unknown;
    convertedBy: unknown;
    contractAmount: unknown;
    conversionNote: unknown;
  },
>(dto: T) {
  return {
    ...dto,
    convertedAt: null,
    convertedBy: null,
    contractAmount: null,
    conversionNote: null,
  };
}

export function parseLeadConversionInput(body: Record<string, unknown>) {
  const convertedOn = String(body.convertedOn || '').trim();
  if (!isCalendarDate(convertedOn)) {
    throw httpError('请选择有效的签约日期', 400);
  }
  if (convertedOn > chinaDateString()) {
    throw httpError('签约日期不能晚于今天', 400);
  }

  const amountText = String(body.contractAmount ?? '').trim();
  let contractAmount: string | null = null;
  if (amountText) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amountText);
    if (!match) {
      throw httpError('签约金额必须是有效的正数', 400);
    }
    const cents = BigInt(`${match[1]}${(match[2] || '').padEnd(2, '0')}`);
    if (cents <= BigInt(0) || cents > BigInt('99999999999999')) {
      throw httpError('签约金额必须是有效的正数', 400);
    }
    const normalized = cents.toString().padStart(3, '0');
    contractAmount = `${normalized.slice(0, -2)}.${normalized.slice(-2)}`;
  }

  const conversionNote = String(body.conversionNote || '').trim() || null;
  if (conversionNote && conversionNote.length > 200) {
    throw httpError('签约备注不能超过 200 个字符', 400);
  }

  return { convertedOn, contractAmount, conversionNote };
}

export function parseConversionRevertReason(body: Record<string, unknown>) {
  const reason = String(body.reason || '').trim();
  if (!reason) throw httpError('请填写撤销原因', 400);
  if (reason.length > 200) throw httpError('撤销原因不能超过 200 个字符', 400);
  return reason;
}

export function isProtectedConversionStatusChange(
  currentStatus: string,
  requestedStatus: string
) {
  const current = normalizeLeadStatus(currentStatus);
  const requested = normalizeLeadStatus(requestedStatus);
  return requested === 'converted' || (current === 'converted' && requested !== 'converted');
}

export { chinaDateString };
