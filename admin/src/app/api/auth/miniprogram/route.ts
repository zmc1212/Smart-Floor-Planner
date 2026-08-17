import bcrypt from 'bcryptjs';
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
import {
  defaultMiniProgramIdentityContext,
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

export const dynamic = 'force-dynamic';

interface WechatSessionIdentity {
  openid: string;
  unionid?: string;
}

async function getWechatIdentity(code: string): Promise<WechatSessionIdentity> {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }
  if (!code) throw new Error('WeChat login code is required');

  const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
  const response = await fetch(wxApiUrl);
  const data = await response.json();
  if (data.errcode || !data.openid) {
    throw new Error(data.errmsg || 'WeChat API error');
  }
  return { openid: data.openid, unionid: data.unionid };
}

async function getWechatPhoneNumber(phoneCode: string) {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }
  if (!phoneCode) throw new Error('WeChat phone code is required');

  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (tokenData.errcode || !tokenData.access_token) {
    throw new Error(tokenData.errmsg || 'Unable to obtain WeChat access token');
  }

  const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenData.access_token}`;
  const phoneRes = await fetch(phoneUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: phoneCode }),
  });
  const phoneData = await phoneRes.json();
  if (phoneData.errcode !== 0 || !phoneData.phone_info?.phoneNumber) {
    throw new Error(phoneData.errmsg || 'Unable to obtain WeChat phone number');
  }
  return phoneData.phone_info.phoneNumber as string;
}

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
  try {
    const body = await request.json();
    const { type } = body;
    let identity: IdentityResult | null = null;

    if (type === 'password') {
      const identifier = body.username?.trim();
      if (!identifier || !body.password) {
        return badRequest('请输入用户名和密码');
      }
      const result = await withPlatformTransaction(async (transaction) => {
        const staff = await new AdminUserRepository(
          transaction
        ).findByUsernameOrPhone(identifier, true);
        if (!staff) return null;
        if (!(await bcrypt.compare(body.password, staff.passwordHash))) {
          return null;
        }
        const user = await new MiniProgramIdentityRepository(
          transaction
        ).ensureStaffUser(staff);
        return { staff, user };
      });
      if (!result) {
        return NextResponse.json(
          { success: false, error: '用户名或密码错误' },
          { status: 401 }
        );
      }
      identity = {
        ...result,
        openid: result.staff.openid,
        source: 'password',
      };
    } else if (type === 'wechat_code') {
      const wechat = await getWechatIdentity(body.code);
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
      const [wechat, phone] = await Promise.all([
        getWechatIdentity(body.loginCode),
        getWechatPhoneNumber(body.phoneCode),
      ]);
      const result = await withPlatformTransaction(async (transaction) => {
        const identities = new MiniProgramIdentityRepository(transaction);
        const user = await identities.resolveWechatPhoneUser({
          openid: wechat.openid,
          unionid: wechat.unionid,
          phone,
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
        const selectedContext = await identities.selectContext(user.id, {
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
        if (!selectedContext) return null;
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
    const token = await signMiniProgramIdentityContextToken({
      userId: user.id,
      contextVersion: user.contextVersion,
      context: responseContext.selected,
      source,
    });

    return NextResponse.json({
      success: true,
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
        openid,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[UnifiedAuth] Error:', error);
    const status = [
      'WECHAT_IDENTITY_ALREADY_LINKED',
      'WECHAT_USER_ALREADY_LINKED',
      'STAFF_PHONE_LINKED_TO_OTHER_USER',
    ].includes(message)
      ? 409
      : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
