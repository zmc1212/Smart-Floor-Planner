import type {
  MiniProgramIdentityContextRecord,
  MiniProgramIdentityMode,
} from '@/db/repositories';
import {
  type MiniProgramBadgeSummary,
  unavailableMiniProgramBadges,
} from '@/lib/miniprogram-badges';
import { miniProgramIdentityContextToDto } from '@/lib/miniprogram-identity-context';

export type MiniProgramRole =
  | 'customer'
  | 'referrer'
  | 'designer'
  | 'measurer'
  | 'salesperson'
  | 'enterprise_admin'
  | 'platform_admin';

export const MINI_PROGRAM_ROLE_LANDINGS: Record<MiniProgramRole, string> = {
  customer: '/pages/index/index',
  referrer: '/packages/business/referrer-workbench/referrer-workbench',
  designer: '/pages/index/index',
  measurer: '/pages/index/index',
  salesperson: '/packages/business/promotion-records/promotion-records',
  enterprise_admin: '/pages/index/index',
  platform_admin: '/packages/platform/devices/devices',
};

const ROLE_LABELS: Record<MiniProgramRole, string> = {
  customer: '客户',
  referrer: '推荐人',
  designer: '家装设计顾问',
  measurer: '家装现场顾问',
  salesperson: '渠道地推',
  enterprise_admin: '企业负责人',
  platform_admin: '平台管理员',
};

const ROLE_CAPABILITIES: Record<MiniProgramRole, string[]> = {
  customer: ['customer.service', 'customer.projects', 'account'],
  referrer: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'],
  designer: ['staff.leads', 'staff.data', 'staff.appointments', 'staff.design', 'staff.earnings', 'referrer.network', 'account'],
  measurer: ['staff.schedule', 'staff.data', 'staff.tasks', 'staff.surveying', 'staff.earnings', 'referrer.network', 'account'],
  salesperson: ['promotion.records', 'promotion.commissions', 'referrer.network', 'account'],
  enterprise_admin: ['enterprise.operations', 'enterprise.customers', 'enterprise.appointments', 'enterprise.commissions', 'referrer.network', 'account'],
  platform_admin: ['platform.review', 'platform.devices', 'account'],
};

type MiniProgramCapabilityContext = Pick<
  MiniProgramIdentityContextRecord,
  'mode' | 'staffRole'
> & {
  enterpriseId: bigint | string | null | undefined;
};

export function getMiniProgramRole(
  context: Pick<MiniProgramIdentityContextRecord, 'mode' | 'staffRole'>
): MiniProgramRole | null {
  if (context.mode === 'customer') return 'customer';
  if (context.mode === 'referrer') return 'referrer';
  if (context.mode === 'staff') {
    if (context.staffRole === 'designer') return 'designer';
    if (context.staffRole === 'measurer') return 'measurer';
    if (context.staffRole === 'salesperson') return 'salesperson';
    if (context.staffRole === 'enterprise_admin') return 'enterprise_admin';
    if (context.staffRole === 'admin' || context.staffRole === 'super_admin') {
      return 'platform_admin';
    }
  }
  return null;
}

export function getMiniProgramCapabilities(
  context: MiniProgramCapabilityContext
): string[] {
  const role = getMiniProgramRole(context);
  if (!role) return [];
  const hasEnterprise =
    typeof context.enterpriseId === 'bigint'
      ? context.enterpriseId > BigInt(0)
      : typeof context.enterpriseId === 'string' &&
        /^[1-9]\d*$/.test(context.enterpriseId);
  return ROLE_CAPABILITIES[role].filter(
    (capability) => capability !== 'referrer.network' || hasEnterprise
  );
}

export function buildMiniProgramBootstrap(input: {
  current: MiniProgramIdentityContextRecord;
  contexts: MiniProgramIdentityContextRecord[];
  badges?: MiniProgramBadgeSummary;
}) {
  const currentRole = getMiniProgramRole(input.current);
  if (!currentRole) throw new Error('MINIPROGRAM_IDENTITY_ROLE_UNSUPPORTED');
  const groups = new Map<MiniProgramRole, MiniProgramIdentityContextRecord[]>();
  for (const context of input.contexts) {
    const role = getMiniProgramRole(context);
    if (!role) continue;
    groups.set(role, [...(groups.get(role) || []), context]);
  }
  const roles = [...groups.entries()].map(([role, contexts]) => ({
    role,
    mode: contexts[0].mode as MiniProgramIdentityMode,
    label: ROLE_LABELS[role],
    // Referrer memberships remain selectable inside the one referrer role.
    context: miniProgramIdentityContextToDto(contexts[0]),
    contexts: contexts.map(miniProgramIdentityContextToDto),
    landingPath: MINI_PROGRAM_ROLE_LANDINGS[role],
    capabilities: getMiniProgramCapabilities(contexts[0]),
  }));

  const currentCapabilities = getMiniProgramCapabilities(input.current);

  return {
    current: {
      role: currentRole,
      mode: input.current.mode,
      context: miniProgramIdentityContextToDto(input.current),
      landingPath: MINI_PROGRAM_ROLE_LANDINGS[currentRole],
      capabilities: currentCapabilities,
    },
    roles,
    navigation: {
      capabilities: [...currentCapabilities],
      landingPath: MINI_PROGRAM_ROLE_LANDINGS[currentRole],
    },
    // Badge counts are server-owned. Unknown or failed queries stay
    // unavailable instead of a local zero.
    badges: input.badges || unavailableMiniProgramBadges(),
    recovery: {
      canSwitch: roles.length > 1,
      validRoleCount: roles.length,
    },
  };
}
