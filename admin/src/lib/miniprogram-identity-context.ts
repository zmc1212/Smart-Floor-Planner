import type {
  MiniProgramIdentityContextRecord,
  MiniProgramIdentityMode,
} from '@/db/repositories';
import {
  signMiniProgramToken,
  type MiniProgramJWTPayload,
} from '@/lib/miniprogram-jwt';

export function miniProgramIdentityContextToDto(
  context: MiniProgramIdentityContextRecord
) {
  return {
    mode: context.mode,
    enterpriseId: context.enterpriseId?.toString() ?? null,
    enterpriseName: context.enterpriseName,
    staffId: context.staffId?.toString() ?? null,
    staffRole: context.staffRole,
    staffDisplayName: context.staffDisplayName,
    referrerMembershipId:
      context.referrerMembershipId?.toString() ?? null,
  };
}

export function isMiniProgramIdentityContextSupported(
  context: Pick<MiniProgramIdentityContextRecord, 'mode' | 'staffRole'>
) {
  if (context.mode === 'customer' || context.mode === 'referrer') return true;
  return context.mode === 'staff' && [
    'designer',
    'measurer',
    'salesperson',
    'enterprise_admin',
    'admin',
    'super_admin',
  ].includes(context.staffRole || '');
}

export function defaultMiniProgramIdentityContext(
  contexts: MiniProgramIdentityContextRecord[]
) {
  return (
    contexts.find(
      (context) =>
        context.mode === 'staff' &&
        isMiniProgramIdentityContextSupported(context)
    ) ??
    contexts.find((context) => context.mode === 'referrer') ??
    contexts[0]
  );
}

export async function signMiniProgramIdentityContextToken(input: {
  userId: bigint;
  contextVersion: number;
  context: MiniProgramIdentityContextRecord;
  source: MiniProgramJWTPayload['source'];
}) {
  const { context } = input;
  return signMiniProgramToken({
    sub: input.userId.toString(),
    id: input.userId.toString(),
    mode: context.mode,
    role: context.mode === 'staff'
      ? (context.staffRole as MiniProgramJWTPayload['role'])
      : 'user',
    staffRole: context.staffRole ?? undefined,
    enterpriseId: context.enterpriseId?.toString(),
    staffId: context.staffId?.toString(),
    referrerMembershipId: context.referrerMembershipId?.toString(),
    contextVersion: input.contextVersion,
    source: input.source,
  });
}

export function isMiniProgramIdentityMode(
  value: unknown
): value is MiniProgramIdentityMode {
  return value === 'customer' || value === 'staff' || value === 'referrer';
}
