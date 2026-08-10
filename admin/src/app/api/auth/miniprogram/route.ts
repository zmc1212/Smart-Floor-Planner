import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import {
  AdminUserRepository,
  EnterpriseRepository,
  type AdminUserRecord,
  type UserRecord,
  UserRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  signMiniProgramToken,
  verifyMiniProgramToken,
  type MiniProgramJWTPayload,
} from '@/lib/miniprogram-jwt';
import {
  getEffectivePermissions,
  getWorkbenchType,
} from '@/lib/staff-access';
import { resolveProfileAvatarUrl } from '@/lib/miniprogram-profile';

export const dynamic = 'force-dynamic';

async function getWechatOpenid(code: string) {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }

  const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
  const response = await fetch(wxApiUrl);
  const data = await response.json();
  if (data.errcode) throw new Error(data.errmsg || 'WeChat API error');
  return data.openid as string;
}

async function getWechatPhoneNumber(phoneCode: string) {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (tokenData.errcode) throw new Error(tokenData.errmsg);

  const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenData.access_token}`;
  const phoneRes = await fetch(phoneUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: phoneCode }),
  });
  const phoneData = await phoneRes.json();
  if (phoneData.errcode !== 0) throw new Error(phoneData.errmsg);
  return phoneData.phone_info.phoneNumber as string;
}

interface IdentityResult {
  staff: AdminUserRecord;
  user: UserRecord | null;
  source: MiniProgramJWTPayload['source'];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type } = body;
    let identity: IdentityResult | null = null;

    if (type === 'password') {
      const identifier = body.username?.trim();
      if (!identifier || !body.password) {
        return NextResponse.json(
          { success: false, error: '请输入用户名和密码' },
          { status: 400 }
        );
      }
      const result = await withPlatformTransaction(async (transaction) => {
        const staff = await new AdminUserRepository(
          transaction
        ).findByUsernameOrPhone(identifier, true);
        const user =
          staff?.phone &&
          (await new UserRepository(transaction).findByPhone(staff.phone));
        return staff ? { staff, user: user || null } : null;
      });
      if (
        !result ||
        !(await bcrypt.compare(body.password, result.staff.passwordHash))
      ) {
        return NextResponse.json(
          { success: false, error: '用户名或密码错误' },
          { status: 401 }
        );
      }
      identity = { ...result, source: 'password' };
    } else if (type === 'wechat_code') {
      const openid = await getWechatOpenid(body.code);
      const result = await withPlatformTransaction(async (transaction) => {
        const users = new UserRepository(transaction);
        const adminUsers = new AdminUserRepository(transaction);
        let user = await users.findByOpenid(openid);
        const staff = await adminUsers.findByOpenidOrPhone(
          openid,
          user?.phone
        );
        if (!staff) return null;
        if (!user) {
          user = await users.create({ openid, role: 'staff' });
        }
        if (!staff.openid) {
          await adminUsers.update(staff.id, { openid });
          staff.openid = openid;
        }
        return { staff, user };
      });
      if (!result) {
        return NextResponse.json(
          {
            success: false,
            error: '该微信尚未绑定账号，请联系管理员维护手机号或绑定信息。',
          },
          { status: 403 }
        );
      }
      identity = { ...result, source: 'wechat' };
    } else if (type === 'wechat_phone') {
      const openid = await getWechatOpenid(body.loginCode);
      const phone = await getWechatPhoneNumber(body.phoneCode);
      const result = await withPlatformTransaction(async (transaction) => {
        const users = new UserRepository(transaction);
        const adminUsers = new AdminUserRepository(transaction);
        const staff = await adminUsers.findByOpenidOrPhone(openid, phone);
        if (!staff) return null;

        let user = await users.findByOpenid(openid);
        if (!user) {
          user = await users.create({ openid, phone, role: 'staff' });
        } else {
          user = (await users.update(user.id, {
            phone,
            role: 'staff',
          }))!;
        }
        if (!staff.openid) {
          await adminUsers.update(staff.id, { openid });
          staff.openid = openid;
        }
        return { staff, user };
      });
      if (!result) {
        return NextResponse.json(
          {
            success: false,
            error: '该手机号尚未开通账号，请联系管理员添加账号信息。',
          },
          { status: 403 }
        );
      }
      identity = { ...result, source: 'phone' };
    } else if (type === 'refresh') {
      const payload = await verifyMiniProgramToken(body.token);
      if (!payload) {
        return NextResponse.json(
          { success: false, error: 'Invalid token' },
          { status: 401 }
        );
      }
      const result = await withPlatformTransaction(async (transaction) => {
        const staff = await new AdminUserRepository(transaction).findById(
          parsePostgresId(payload.id, 'staff id')
        );
        if (!staff || staff.status !== 'active') return null;
        const user = staff.phone
          ? await new UserRepository(transaction).findByPhone(staff.phone)
          : null;
        return { staff, user };
      });
      if (!result) {
        return NextResponse.json(
          { success: false, error: 'Staff account disabled' },
          { status: 403 }
        );
      }
      identity = { ...result, source: payload.source };
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid login method' },
        { status: 400 }
      );
    }

    const { staff, user, source } = identity;
    const enterpriseName = staff.enterpriseId
      ? await withPlatformTransaction(async (transaction) => {
          const enterprise = await new EnterpriseRepository(
            transaction
          ).findById(staff.enterpriseId!);
          return enterprise?.name || '';
        })
      : '';
    const openid = user?.openid || staff.openid || `staff_${staff.id}`;
    const staffPermissions = await getEffectivePermissions(
      staff.role,
      staff.menuPermissions
    );
    const token = await signMiniProgramToken({
      id: staff.id.toString(),
      role: staff.role as MiniProgramJWTPayload['role'],
      staffRole: staff.role,
      enterpriseId: staff.enterpriseId?.toString(),
      openid,
      source,
    });

    return NextResponse.json({
      success: true,
      token,
      openid,
      user: {
        nickname:
          user?.nickname || staff.displayName || staff.username || '用户',
        avatar: user
          ? resolveProfileAvatarUrl({
              request,
              userId: user.id.toString(),
              avatar: user.avatar,
            })
          : '',
        phone: user?.phone || staff.phone || '',
        role: 'staff',
        staffRole: staff.role,
        staffPermissions,
        enterpriseId: staff.enterpriseId?.toString() || '',
        enterpriseName,
        staffId: staff.id.toString(),
        workbenchType: getWorkbenchType(staff.role),
        openid,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[UnifiedAuth] Error:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
