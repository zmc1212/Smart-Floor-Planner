import {
  adminUserToDto,
  enterpriseToDto,
  parsePostgresId,
  userToDto,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  EnterpriseRepository,
  MiniProgramIdentityRepository,
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
  logo?: string | null;
  branding?: Record<string, unknown>;
  automationConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MiniProgramContext {
  readonly user: MiniProgramUser;
  readonly staff: MiniProgramStaff | null;
  readonly enterprise: MiniProgramEnterprise | null;
  readonly enterpriseId: string | undefined;
  readonly mode: 'customer' | 'staff' | 'referrer';
  readonly referrerMembershipId: string | undefined;
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
      const identities = new MiniProgramIdentityRepository(transaction);
      const userId = parsePostgresId(payload.sub, 'user id');
      const userRecord = await identities.findUserById(userId);
      if (!userRecord || userRecord.contextVersion !== payload.contextVersion) {
        console.warn(`[Auth] MiniProgram context version mismatch for user: ${payload.sub}`);
        return null;
      }

      const selectedContext = await identities.selectContext(userId, {
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
      if (!selectedContext) {
        console.warn(`[Auth] MiniProgram identity context is no longer active: ${payload.sub}`);
        return null;
      }

      const staffRecord = selectedContext.staffId
        ? await new AdminUserRepository(transaction).findById(
            selectedContext.staffId
          )
        : null;
      const wechatIdentity = await identities.findWechatIdentityByUserId(userId);

      const staff = staffRecord
        ? (adminUserToDto(staffRecord) as unknown as MiniProgramStaff)
        : null;
      const user = {
        ...(userToDto(userRecord) as unknown as MiniProgramUser),
        openid: wechatIdentity?.openid,
      };
      const enterpriseId = selectedContext.enterpriseId;
      const enterpriseRecord = enterpriseId
        ? await new EnterpriseRepository(transaction).findById(enterpriseId)
        : null;

      const enterpriseActive =
        !enterpriseRecord || enterpriseRecord.status === 'active';
      if (!enterpriseActive) {
        // Staff/referrer workbenches require an active enterprise; drop the
        // whole context so callers treat the session as unavailable.
        if (
          selectedContext.mode === 'staff' ||
          selectedContext.mode === 'referrer'
        ) {
          console.warn(
            `[Auth] MiniProgram blocked inactive enterprise ${enterpriseId?.toString()} status=${enterpriseRecord?.status}`
          );
          return null;
        }
        // Customer mode keeps the user but loses inactive enterprise branding.
        return {
          user,
          staff: null,
          enterprise: null,
          enterpriseId: undefined,
          mode: selectedContext.mode,
          referrerMembershipId: undefined,
        };
      }

      return {
        user,
        staff,
        enterprise: enterpriseRecord
          ? (enterpriseToDto(
              enterpriseRecord
            ) as unknown as MiniProgramEnterprise)
          : null,
        enterpriseId: enterpriseId?.toString(),
        mode: selectedContext.mode,
        referrerMembershipId:
          selectedContext.referrerMembershipId?.toString(),
      };
    });
  } catch (error) {
    console.warn('[Auth] MiniProgram identity resolution failed', error);
    return null;
  }
}
