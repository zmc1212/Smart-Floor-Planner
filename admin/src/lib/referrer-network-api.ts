import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type {
  EnterpriseJoinCodeType,
  MiniProgramIdentityContextRecord,
  MiniProgramIdentityRepository,
  ReferrerMembershipRecord,
} from '@/db/repositories';
import type { enterpriseJoinCodeEvents, enterpriseJoinCodes } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  createReferrerPromotionToken,
} from '@/db/repositories';
import {
  verifyMiniProgramToken,
  type MiniProgramJWTPayload,
} from '@/lib/miniprogram-jwt';

export function isEnterpriseJoinCodeType(
  value: unknown
): value is EnterpriseJoinCodeType {
  return value === 'staff' || value === 'referrer';
}

export function normalizeOpaqueToken(value: unknown) {
  const token = typeof value === 'string' ? value.trim() : '';
  return token.length >= 24 && token.length <= 128 ? token : null;
}

export async function readMiniProgramPayload(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  return token ? verifyMiniProgramToken(token) : null;
}

export async function validateMiniProgramIdentity(
  transaction: PostgresTransaction,
  payload: MiniProgramJWTPayload,
  identities: MiniProgramIdentityRepository
) {
  const userId = parsePostgresId(payload.sub, 'user id');
  const user = await identities.findUserById(userId);
  if (!user || user.contextVersion !== payload.contextVersion) return null;
  const selected = await identities.selectContext(user.id, {
    mode: payload.mode,
    enterpriseId: payload.enterpriseId
      ? parsePostgresId(payload.enterpriseId, 'enterprise id')
      : null,
    staffId: payload.staffId
      ? parsePostgresId(payload.staffId, 'staff id')
      : null,
    referrerMembershipId: payload.referrerMembershipId
      ? parsePostgresId(payload.referrerMembershipId, 'referrer membership id')
      : null,
  });
  return selected ? { user, selected, transaction } : null;
}

export function enterpriseJoinCodeToDto(
  code: typeof enterpriseJoinCodes.$inferSelect
) {
  return {
    id: code.id.toString(),
    enterpriseId: code.enterpriseId.toString(),
    codeType: code.codeType,
    inviterStaffId: code.inviterStaffId?.toString() ?? null,
    status: code.status,
    version: code.version,
    expiresAt: code.expiresAt,
    disabledAt: code.disabledAt,
    createdAt: code.createdAt,
    updatedAt: code.updatedAt,
  };
}

export function enterpriseJoinCodeEventToDto(input: {
  event: typeof enterpriseJoinCodeEvents.$inferSelect;
  codeType: string;
}) {
  return {
    id: input.event.id.toString(),
    joinCodeId: input.event.joinCodeId.toString(),
    codeType: input.codeType,
    eventType: input.event.eventType,
    result: input.event.result,
    actorUserId: input.event.actorUserId?.toString() ?? null,
    actorStaffId: input.event.actorStaffId?.toString() ?? null,
    metadata: input.event.metadata ?? {},
    createdAt: input.event.createdAt,
  };
}

export function promotionCodeToDto(input: {
  id: bigint;
  enterpriseId: bigint;
  membershipId: bigint;
  status: string;
  version: number;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: input.id.toString(),
    enterpriseId: input.enterpriseId.toString(),
    membershipId: input.membershipId.toString(),
    status: input.status,
    version: input.version,
    disabledAt: input.disabledAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function referrerMembershipToDto(record: ReferrerMembershipRecord) {
  const { membership, promotionCode } = record;
  return {
    id: membership.id.toString(),
    enterpriseId: membership.enterpriseId.toString(),
    enterpriseName: record.enterpriseName,
    status: membership.status,
    joinedAt: membership.joinedAt,
    exitedAt: membership.exitedAt,
    hasActivePromotionCode: promotionCode?.status === 'active',
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

export function promotionTokenForCode(input: {
  membershipId: bigint;
  version: number;
}) {
  return createReferrerPromotionToken(input.membershipId, input.version);
}

export function referrerNetworkError(
  code: string,
  options: { status?: number; message?: string } = {}
) {
  const status =
    options.status ??
    (code === 'code_not_found'
      ? 404
      : ['code_rotated', 'code_disabled', 'code_expired'].includes(code)
        ? 410
        : ['staff_enterprise_conflict', 'membership_limit_reached', 'referrer_protection_limit', 'phone_mismatch'].includes(code)
          ? 409
          : 400);
  return NextResponse.json(
    { success: false, code, error: options.message ?? code },
    { status }
  );
}

export function hashRequestAddress(request: Request) {
  const address =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim();
  if (!address) return null;
  const salt =
    process.env.REFERRER_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    'fallback_secret_random_123';
  return crypto.createHmac('sha256', salt).update(address).digest('hex');
}

export function sanitizeDeviceSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['platform', 'model', 'system', 'language', 'version'];
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const field = (value as Record<string, unknown>)[key];
      return typeof field === 'string'
        ? [[key, field.trim().slice(0, 120)]]
        : [];
    })
  );
}

export function selectContextAfterMutation(input: {
  contexts: MiniProgramIdentityContextRecord[];
  payload: MiniProgramJWTPayload;
  preferred?: (context: MiniProgramIdentityContextRecord) => boolean;
}) {
  return (
    (input.preferred
      ? input.contexts.find(input.preferred)
      : undefined) ??
    input.contexts.find(
      (context) =>
        context.mode === input.payload.mode &&
        context.staffId?.toString() === (input.payload.staffId ?? undefined) &&
        context.referrerMembershipId?.toString() ===
          (input.payload.referrerMembershipId ?? undefined)
    ) ??
    input.contexts.find((context) => context.mode === 'staff') ??
    input.contexts.find((context) => context.mode === 'referrer') ??
    input.contexts[0]
  );
}
