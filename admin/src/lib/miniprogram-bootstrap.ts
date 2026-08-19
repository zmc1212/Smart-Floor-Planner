import type {
  MiniProgramIdentityContextRecord,
  MiniProgramIdentityMode,
} from '@/db/repositories';
import { miniProgramIdentityContextToDto } from '@/lib/miniprogram-identity-context';

export type MiniProgramRole =
  | 'customer'
  | 'referrer'
  | 'designer'
  | 'measurer'
  | 'enterprise_admin';

export const MINI_PROGRAM_ROLE_LANDINGS: Record<MiniProgramRole, string> = {
  customer: '/pages/index/index',
  referrer: '/packages/business/referrer-workbench/referrer-workbench',
  designer: '/pages/index/index',
  measurer: '/pages/index/index',
  enterprise_admin: '/pages/index/index',
};

const ROLE_LABELS: Record<MiniProgramRole, string> = {
  customer: '客户',
  referrer: '推荐人',
  designer: '设计师',
  measurer: '测量员',
  enterprise_admin: '企业负责人',
};

const ROLE_CAPABILITIES: Record<MiniProgramRole, string[]> = {
  customer: ['customer.service', 'customer.projects', 'account'],
  referrer: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'],
  designer: ['staff.leads', 'staff.appointments', 'staff.design', 'account'],
  measurer: ['staff.schedule', 'staff.tasks', 'staff.surveying', 'account'],
  enterprise_admin: ['enterprise.operations', 'enterprise.customers', 'enterprise.appointments', 'account'],
};

export function getMiniProgramRole(
  context: Pick<MiniProgramIdentityContextRecord, 'mode' | 'staffRole'>
): MiniProgramRole | null {
  if (context.mode === 'customer') return 'customer';
  if (context.mode === 'referrer') return 'referrer';
  if (context.mode === 'staff') {
    if (context.staffRole === 'designer') return 'designer';
    if (context.staffRole === 'measurer') return 'measurer';
    if (context.staffRole === 'enterprise_admin') return 'enterprise_admin';
  }
  return null;
}

export function buildMiniProgramBootstrap(input: {
  current: MiniProgramIdentityContextRecord;
  contexts: MiniProgramIdentityContextRecord[];
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
    capabilities: [...ROLE_CAPABILITIES[role]],
  }));

  return {
    current: {
      role: currentRole,
      mode: input.current.mode,
      context: miniProgramIdentityContextToDto(input.current),
      landingPath: MINI_PROGRAM_ROLE_LANDINGS[currentRole],
      capabilities: [...ROLE_CAPABILITIES[currentRole]],
    },
    roles,
    navigation: {
      capabilities: [...ROLE_CAPABILITIES[currentRole]],
      landingPath: MINI_PROGRAM_ROLE_LANDINGS[currentRole],
    },
    // Badge counts are deliberately server-owned. An empty object means no
    // count has been queried yet; clients must not synthesize local numbers.
    badges: {},
    recovery: {
      canSwitch: roles.length > 1,
      validRoleCount: roles.length,
    },
  };
}
