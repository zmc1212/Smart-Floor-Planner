import { NextResponse } from 'next/server';
import {
  AdminUserRepository,
  MiniProgramIdentityRepository,
  type AdminUserRecord,
  type MiniProgramIdentityContextRecord,
  type UserRecord,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withMiniProgramRequestLog, type MiniProgramRequestLog } from '@/lib/miniprogram-request-log';
import {
  defaultMiniProgramIdentityContext,
  isMiniProgramIdentityContextSupported,
  miniProgramIdentityContextToDto,
  signMiniProgramIdentityContextToken,
} from '@/lib/miniprogram-identity-context';
import {
  verifyMiniProgramToken,
  type MiniProgramJWTPayload,
} from '@/lib/miniprogram-jwt';
import {
  getEffectivePermissions,
  getWorkbenchType,
} from '@/lib/staff-access';
import { resolveProfileAvatarUrl } from '@/lib/miniprogram-profile';
import {
  getWechatSessionIdentity,
  resolveWechatPhoneLogin,
} from '@/lib/wechat-miniprogram-auth';
import { authenticateAdminCredential } from '@/lib/admin-credential-auth';

export const dynamic = 'force-dynamic';

interface IdentityResult {
  user: UserRecord;
  staff: AdminUserRecord | null;
  openid: string | null;
  source: MiniProgramJWTPayload['source'];
  selectedContext?: MiniProgramIdentityContextRecord;
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(request: Request) {
  return withMiniProgramRequestLog(request, '/api/auth/miniprogram', (log) => authenticate(request, log));
}

async function authenticate(request: Request, log: MiniProgramRequestLog) {
  try {
    log.stage('parse_body');
    const body = await request.json();
    const { type } = body;
    let identity: IdentityResult | null = null;

    if (type === 'password') {
      log.stage('password_login');
      const identifier = body.username?.trim();
      if (!identifier || !body.password) {
        return badRequest('请输入用户名和密码');
      }
      const result = await withPlatformTransaction(async (transaction) => {
        const repository = new AdminUserRepository(transaction);
        const credential = await authenticateAdminCredential(
          repository,
          identifier,
          body.password
        );
        if (credential.kind !== 'ok') return credential;
        const staff = credential.admin;
        const user = await new MiniProgramIdentityRepository(
          transaction
        ).ensureStaffUser(staff);
        return { kind: 'ok' as const, staff, user };
      });
      if (result.kind === 'invalid_credentials') {
        return NextResponse.json(
          { success: false, error: '手机号/账号或密码错误' },
          { status: 401 }
        );
      }
      if (result.kind === 'ambiguous_identifier') {
        return NextResponse.json(
          {
            success: false,
            code: 'ambiguous_identifier',
            error: '该手机号关联多个账号，请改用企业负责人提供的内部登录账号',
          },
          { status: 409 }
        );
      }
      identity = {
        staff: result.staff,
        user: result.user,
        openid: result.staff.openid,
        source: 'password',
      };
    } else if (type === 'wechat_code') {
      log.stage('wechat_code');
      const wechat = await getWechatSessionIdentity(body.code);
      log.stage('database');
      const result = await withPlatformTransaction(async (transaction) => {
        const identities = new MiniProgramIdentityRepository(transaction);
        const existing = await identities.findByOpenid(wechat.openid);
        if (existing) {
          return {
            user: existing.user,
            staff: await identities.findActiveStaffByUserId(existing.user.id),
          };
        }

        const legacyStaff = await new AdminUserRepository(
          transaction
        ).findByOpenidOrPhone(wechat.openid);
        if (!legacyStaff) return null;
        const user = await identities.ensureStaffUser(legacyStaff);
        await identities.attachWechatIdentity({
          userId: user.id,
          openid: wechat.openid,
          unionid: wechat.unionid,
        });
        return { user, staff: legacyStaff };
      });
      if (!result) {
        return NextResponse.json(
          {
            success: false,
            error: '该微信尚未完成手机号授权，请使用手机号快捷登录。',
          },
          { status: 403 }
        );
      }
      identity = {
        ...result,
        openid: wechat.openid,
        source: 'wechat',
      };
    } else if (type === 'wechat_phone') {
      log.stage('wechat_phone');
      const wechat = await resolveWechatPhoneLogin(body);
      log.stage('database');
      const result = await withPlatformTransaction(async (transaction) => {
        const identities = new MiniProgramIdentityRepository(transaction);
        const user = await identities.resolveWechatPhoneUser({
          openid: wechat.openid,
          unionid: wechat.unionid,
          phone: wechat.phone,
        });
        const staff = await identities.findActiveStaffByUserId(user.id);
        return { user, staff };
      });
      identity = {
        ...result,
        openid: wechat.openid,
        source: 'phone',
      };
    } else if (type === 'refresh') {
      log.stage('refresh');
      const payload = await verifyMiniProgramToken(body.token);
      if (!payload) {
        return NextResponse.json(
          { success: false, error: 'Invalid token' },
          { status: 401 }
        );
      }
      const result = await withPlatformTransaction(async (transaction) => {
        const identities = new MiniProgramIdentityRepository(transaction);
        const user = await identities.findUserById(
          parsePostgresId(payload.sub, 'user id')
        );
        if (!user || user.contextVersion !== payload.contextVersion) return null;
        const requestedContext = await identities.selectContext(user.id, {
          mode: payload.mode,
          enterpriseId: payload.enterpriseId
            ? parsePostgresId(payload.enterpriseId, 'enterprise id')
            : null,
          staffId: payload.staffId
            ? parsePostgresId(payload.staffId, 'staff id')
            : null,
          referrerMembershipId: payload.referrerMembershipId
            ? parsePostgresId(
                payload.referrerMembershipId,
                'referrer membership id'
              )
            : null,
        });
        if (!requestedContext) return null;
        const contexts = await identities.listContexts(user.id);
        const selectedContext = isMiniProgramIdentityContextSupported(
          requestedContext
        )
          ? requestedContext
          : defaultMiniProgramIdentityContext(contexts);
        return {
          user,
          staff: selectedContext.staffId
            ? await new AdminUserRepository(transaction).findById(
                selectedContext.staffId
              )
            : null,
          openid:
            (await identities.findWechatIdentityByUserId(user.id))?.openid ??
            null,
          selectedContext,
        };
      });
      if (!result) {
        return NextResponse.json(
          { success: false, error: 'Identity context changed' },
          { status: 401 }
        );
      }
      identity = { ...result, source: payload.source };
    } else {
      return badRequest('Invalid login method');
    }

    log.stage('database');
    const responseContext = await withPlatformTransaction(
      async (transaction) => {
        const identities = new MiniProgramIdentityRepository(transaction);
        const contexts = await identities.listContexts(identity!.user.id);
        const selected =
          identity!.selectedContext ??
          defaultMiniProgramIdentityContext(contexts);
        return { contexts, selected };
      }
    );
    const { user, openid, source } = identity;
    const selectedStaff = responseContext.selected.staffId
      ? identity.staff
      : null;
    const staffPermissions = selectedStaff
      ? await getEffectivePermissions(
          selectedStaff.role,
          selectedStaff.menuPermissions
        )
      : [];
    log.stage('sign_token');
    const token = await signMiniProgramIdentityContextToken({
      userId: user.id,
      contextVersion: user.contextVersion,
      context: responseContext.selected,
      source,
      mustChangePassword:
        source === 'password' && selectedStaff?.mustChangePassword === true,
    });

    const requiresPasswordChange =
      source === 'password' && selectedStaff?.mustChangePassword === true;

    return NextResponse.json({
      success: true,
      requiresPasswordChange,
      token,
      openid,
      mode: responseContext.selected.mode,
      context: miniProgramIdentityContextToDto(responseContext.selected),
      contexts: responseContext.contexts.map(miniProgramIdentityContextToDto),
      user: {
        nickname:
          user.nickname ||
          selectedStaff?.displayName ||
          selectedStaff?.username ||
          '用户',
        avatar: resolveProfileAvatarUrl({
          request,
          userId: user.id.toString(),
          avatar: user.avatar,
        }),
        phone: user.phone || selectedStaff?.phone || '',
        role: responseContext.selected.mode === 'staff' ? 'staff' : 'user',
        mode: responseContext.selected.mode,
        staffRole: responseContext.selected.staffRole || '',
        staffPermissions,
        enterpriseId:
          responseContext.selected.enterpriseId?.toString() || '',
        enterpriseName: responseContext.selected.enterpriseName || '',
        staffId: responseContext.selected.staffId?.toString() || '',
        referrerMembershipId:
          responseContext.selected.referrerMembershipId?.toString() || '',
        workbenchType: getWorkbenchType(
          responseContext.selected.staffRole || undefined
        ),
        requiresPasswordChange,
        openid,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(error);
    const identityConflictMessages: Record<string, { code: string; error: string }> = {
      STAFF_PHONE_LINKED_TO_OTHER_USER: {
        code: 'staff_phone_linked_to_other_user',
        error:
          '该手机号已绑定其他微信账号，请使用绑定该号的微信登录，或联系企业管理员。',
      },
      WECHAT_IDENTITY_ALREADY_LINKED: {
        code: 'wechat_identity_conflict',
        error:
          '当前微信已绑定其他账号，请换用本人微信登录，或联系企业管理员处理。',
      },
      WECHAT_USER_ALREADY_LINKED: {
        code: 'wechat_identity_conflict',
        error:
          '当前微信已绑定其他账号，请换用本人微信登录，或联系企业管理员处理。',
      },
    };
    const conflict = identityConflictMessages[message];
    if (conflict) {
      return NextResponse.json(
        { success: false, code: conflict.code, error: conflict.error },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
