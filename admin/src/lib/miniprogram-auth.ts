import mongoose from 'mongoose';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { verifyMiniProgramToken } from './miniprogram-jwt';

export interface MiniProgramContext {
  user: any;
  staff: any;
  enterprise: any;
  enterpriseId: mongoose.Types.ObjectId | undefined;
}

/**
 * Resolves context from a Mini Program request via JWT
 */
export async function resolveMiniProgramContext(req: Request): Promise<MiniProgramContext | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const payload = await verifyMiniProgramToken(token);
  if (!payload) return null;

  let user = null;
  let staff = null;

  if (payload.role === 'staff') {
    // Use collection to bypass tenant filter during identity resolution
    staff = await AdminUser.collection.findOne({ _id: new mongoose.Types.ObjectId(payload.id) });
    if (!staff) return null;

    if (staff.phone) {
      user = await User.collection.findOne({ phone: staff.phone });
    }

    if (!user) {
      // Mock user for UI compatibility
      user = {
        _id: new mongoose.Types.ObjectId(),
        openid: staff.openid || `staff_${staff._id}`,
        nickname: staff.displayName || staff.username,
        role: 'staff',
        enterpriseId: staff.enterpriseId
      };
    }
  } else {
    user = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(payload.id) });
    if (!user) return null;

    staff = await AdminUser.collection.findOne({
      status: 'active',
      $or: [
        { openid: user.openid },
        ...(user.phone ? [{ phone: user.phone }] : [])
      ],
    });
  }

  const enterpriseId = (staff?.enterpriseId || user?.enterpriseId) ? 
    new mongoose.Types.ObjectId(String(staff?.enterpriseId || user?.enterpriseId)) : 
    undefined;

  const enterprise = enterpriseId ? await Enterprise.findById(enterpriseId).lean() : null;

  return { user, staff, enterprise, enterpriseId };
}
