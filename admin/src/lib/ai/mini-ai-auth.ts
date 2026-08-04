import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export type MiniAiContext = {
  enterpriseId: string;
  operatorId: string;
  username: string;
  role: string;
};

export async function resolveMiniAiContext(request: Request): Promise<MiniAiContext | null> {
  const context = await resolveMiniProgramContext(request);
  if (!context?.staff || !context.enterpriseId) return null;

  return {
    enterpriseId: String(context.enterpriseId),
    operatorId: String(context.staff._id),
    username: context.staff.displayName || context.staff.username || 'Mini Program',
    role: context.staff.role || 'staff',
  };
}
