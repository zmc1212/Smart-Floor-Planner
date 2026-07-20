import mongoose from 'mongoose';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export type MiniAiContext = {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  username: string;
  role: string;
};

export async function resolveMiniAiContext(request: Request): Promise<MiniAiContext | null> {
  const context = await resolveMiniProgramContext(request);
  if (!context?.staff || !context.enterpriseId) return null;

  return {
    enterpriseId: new mongoose.Types.ObjectId(String(context.enterpriseId)),
    operatorId: new mongoose.Types.ObjectId(String(context.staff._id)),
    username: context.staff.displayName || context.staff.username || 'Mini Program',
    role: context.staff.role || 'staff',
  };
}
