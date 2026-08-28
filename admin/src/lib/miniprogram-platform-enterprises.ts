import { NextResponse } from 'next/server';
import {
  enterpriseStatusEventToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import type {
  EnterpriseRecord,
  EnterpriseStatusEventRecord,
} from '@/db/repositories';
import { isEnterpriseStatus, listAllowedEnterpriseStatusActions } from '@/lib/enterprise-status';
import {
  resolveMiniProgramContext,
  type MiniProgramContext,
} from '@/lib/miniprogram-auth';

export const PLATFORM_ENTERPRISE_LIST_DEFAULT_STATUS = 'pending_approval';
export const PLATFORM_ENTERPRISE_LIST_ALL = 'all';
export const PLATFORM_ENTERPRISE_SEARCH_MAX = 64;

function contactField(
  contactPerson: EnterpriseRecord['contactPerson'],
  key: 'name' | 'phone'
) {
  if (!contactPerson || typeof contactPerson !== 'object' || Array.isArray(contactPerson)) {
    return '';
  }
  const value = (contactPerson as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function isMiniProgramPlatformAdmin(role?: string | null) {
  return role === 'super_admin' || role === 'admin';
}

export function platformAdminForbiddenResponse() {
  return NextResponse.json(
    { success: false, error: '需要平台管理员身份' },
    { status: 403 }
  );
}

export async function resolveMiniProgramPlatformAdmin(
  request: Request
): Promise<MiniProgramContext | null> {
  const context = await resolveMiniProgramContext(request);
  if (!context?.staff || !isMiniProgramPlatformAdmin(context.staff.role)) {
    return null;
  }
  return context;
}

export function parsePlatformAdminActorId(context: MiniProgramContext) {
  return parsePostgresId(context.staff?._id, 'actor admin id');
}

export function parsePlatformEnterpriseListStatus(raw: string | null) {
  if (raw == null || raw === '') {
    return { status: PLATFORM_ENTERPRISE_LIST_DEFAULT_STATUS as string | null };
  }
  if (raw === PLATFORM_ENTERPRISE_LIST_ALL) {
    return { status: null };
  }
  if (!isEnterpriseStatus(raw)) {
    return { error: '不支持的企业状态筛选' as const };
  }
  return { status: raw };
}

export function parsePlatformEnterpriseListQuery(raw: string | null) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { q: null as string | null };
  return { q: trimmed.slice(0, PLATFORM_ENTERPRISE_SEARCH_MAX) };
}

export function escapeIlikePattern(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

export function platformEnterpriseSearchTerms(q: string | null | undefined) {
  const text = String(q ?? '').trim();
  if (!text) return { text: null as string | null, digits: null as string | null };
  const digits = text.replace(/\D/g, '');
  return {
    text,
    digits: digits.length >= 3 ? digits : null,
  };
}

export function toPlatformEnterpriseReviewDto(
  record: EnterpriseRecord,
  statusEvents?: EnterpriseStatusEventRecord[]
) {
  const dto: Record<string, unknown> = {
    _id: record.id.toString(),
    name: record.name,
    code: record.code,
    status: record.status,
    registrationMode: record.registrationMode,
    contactPerson: {
      name: contactField(record.contactPerson, 'name'),
      phone: contactField(record.contactPerson, 'phone'),
    },
    createdAt: record.createdAt,
    statusReason: record.statusReason ?? null,
    statusChangedAt: record.statusChangedAt ?? null,
    allowedActions: listAllowedEnterpriseStatusActions(record.status),
  };
  if (statusEvents) {
    dto.statusEvents = statusEvents.map((event) => {
      const mapped = enterpriseStatusEventToDto(event);
      return {
        _id: mapped._id,
        fromStatus: mapped.fromStatus,
        toStatus: mapped.toStatus,
        action: mapped.action,
        reason: mapped.reason,
        createdAt: mapped.createdAt,
      };
    });
  }
  return dto;
}
