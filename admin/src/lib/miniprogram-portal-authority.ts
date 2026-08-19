import type { MiniProgramContext } from '@/lib/miniprogram-auth';

export function requireMiniProgramPortalMode(
  context: MiniProgramContext,
  mode: 'customer' | 'referrer'
) {
  if (context.mode !== mode) {
    throw Object.assign(new Error(mode === 'customer' ? '仅客户本人可访问项目索引' : '仅推荐人可访问服务进度和收益'), {
      status: 403,
      code: 'miniprogram_portal_forbidden',
    });
  }
  if (mode === 'referrer' && (!context.enterpriseId || !context.referrerMembershipId)) {
    throw Object.assign(new Error('推荐人企业上下文无效'), {
      status: 403,
      code: 'referrer_membership_context_invalid',
    });
  }
}
