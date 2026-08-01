import {
  adminUserToDto,
  enterpriseToDto,
  parsePostgresId,
  userToDto,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
  UserRepository,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { verifyMiniProgramToken } from './miniprogram-jwt';

interface MiniProgramUser {
  _id: string;
  openid?: string;
  phone?: string;
  nickname?: string;
  role?: string;
  enterpriseId?: string | null;
  [key: string]: unknown;
}

interface MiniProgramStaff {
  _id: string;
  username: string;
  displayName: string;
  role: string;
  enterpriseId?: string;
  departmentId?: string | Record<string, unknown> | null;
  promoterIds?: string[];
  wecomUserId?: string;
  openid?: string;
  phone?: string;
  menuPermissions?: string[];
  status: string;
  [key: string]: unknown;
}

interface MiniProgramEnterprise {
  _id: string;
  name: string;
  code: string;
  branding?: Record<string, unknown>;
  automationConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MiniProgramContext {
  readonly user: MiniProgramUser;
  readonly staff: MiniProgramStaff | null;
  readonly enterprise: MiniProgramEnterprise | null;
  readonly enterpriseId: string | undefined;
}

export async function resolveMiniProgramContext(
  req: Request
): Promise<MiniProgramContext | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const payload = await verifyMiniProgramToken(authHeader.substring(7));
  if (!payload) {
    console.warn('[Auth] MiniProgram token verification failed');
    return null;
  }

  try {
    return await withPlatformTransaction(async (transaction) => {
      const adminUsers = new AdminUserRepository(transaction);
      const users = new UserRepository(transaction);
      let staffRecord = null;
      let userRecord = null;

      if (payload.role !== 'user') {
        staffRecord = await adminUsers.findById(
          parsePostgresId(payload.id, 'staff id')
        );
        if (!staffRecord || staffRecord.status !== 'active') {
          console.warn(`[Auth] Active staff not found for id: ${payload.id}`);
          return null;
        }
        if (staffRecord.phone) {
          userRecord = await users.findByPhone(staffRecord.phone);
        }
      } else {
        userRecord = await users.findById(
          parsePostgresId(payload.id, 'user id')
        );
        if (!userRecord) {
          console.warn(`[Auth] User not found for id: ${payload.id}`);
          return null;
        }
        if (userRecord.openid) {
          staffRecord = await adminUsers.findByOpenidOrPhone(
            userRecord.openid,
            userRecord.phone
          );
        }
      }

      const staff = staffRecord
        ? (adminUserToDto(staffRecord) as unknown as MiniProgramStaff)
        : null;
      const user = userRecord
        ? (userToDto(userRecord) as unknown as MiniProgramUser)
        : {
            _id: `staff_${staffRecord!.id.toString()}`,
            openid:
              staffRecord!.openid || `staff_${staffRecord!.id.toString()}`,
            nickname: staffRecord!.displayName || staffRecord!.username,
            role: 'staff',
            enterpriseId: staffRecord!.enterpriseId?.toString() ?? null,
          };
      const enterpriseId =
        staffRecord?.enterpriseId ?? userRecord?.enterpriseId ?? null;
      const enterpriseRecord = enterpriseId
        ? await new EnterpriseRepository(transaction).findById(enterpriseId)
        : null;

      return {
        user,
        staff,
        enterprise: enterpriseRecord
          ? (enterpriseToDto(
              enterpriseRecord
            ) as unknown as MiniProgramEnterprise)
          : null,
        enterpriseId: enterpriseId?.toString(),
      };
    });
  } catch (error) {
    console.warn('[Auth] MiniProgram identity resolution failed', error);
    return null;
  }
}
