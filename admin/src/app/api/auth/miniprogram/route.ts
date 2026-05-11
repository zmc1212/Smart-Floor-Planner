import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { getEffectivePermissions, getWorkbenchType } from '@/lib/staff-access';
import { signMiniProgramToken, verifyMiniProgramToken } from '@/lib/miniprogram-jwt';

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

  if (data.errcode) {
    throw new Error(data.errmsg || 'WeChat API error');
  }

  return data.openid as string;
}

async function getWechatPhoneNumber(phoneCode: string) {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;

  // Get Access Token (simplified, you might want to cache this in Redis)
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

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    const { type } = body;

    let userId: string | null = null;
    let role: 'user' | 'staff' = 'user';
    let staffData: any = null;
    let userData: any = null;
    let loginSource: 'wechat' | 'password' | 'phone' = 'wechat';

    if (type === 'password') {
      const { username, password } = body;
      const searchIdentifier = username?.trim();
      // Use raw collection to bypass any Mongoose multi-tenant filters
      const admin = await AdminUser.collection.findOne({ 
        $or: [
          { username: searchIdentifier },
          { phone: searchIdentifier }
        ],
        status: 'active'
      });

      if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
        return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
      }

      userId = admin._id.toString();
      role = 'staff';
      staffData = admin;
      loginSource = 'password';

      // Link to User model if possible
      if (admin.phone) {
        userData = await User.findOne({ phone: admin.phone });
      }
    } else if (type === 'wechat_code') {
      const { code } = body;
      const openid = await getWechatOpenid(code);
      loginSource = 'wechat';

      userData = await User.findOne({ openid });
      if (!userData) {
        userData = new User({ openid, role: 'user' });
        await userData.save();
      }

      userId = userData._id.toString();
      role = userData.role;

      // Check if this user is a staff (using raw collection to bypass tenant filters)
      staffData = await AdminUser.collection.findOne({ 
        status: 'active', 
        $or: [{ openid }, ...(userData.phone ? [{ phone: userData.phone }] : [])] 
      });
      if (staffData) role = 'staff';

    } else if (type === 'wechat_phone') {
      const { loginCode, phoneCode } = body;
      const openid = await getWechatOpenid(loginCode);
      const phone = await getWechatPhoneNumber(phoneCode);
      loginSource = 'phone';

      staffData = await AdminUser.collection.findOne({ $or: [{ phone }, { openid }] });
      const isStaff = !!staffData;

      userData = await User.findOne({ openid });
      if (!userData) {
        userData = new User({ openid, phone, role: isStaff ? 'staff' : 'user' });
      } else {
        userData.phone = phone;
        if (isStaff) userData.role = 'staff';
      }
      await userData.save();

      userId = userData._id.toString();
      role = userData.role;

      if (staffData && !staffData.openid) {
        await AdminUser.updateOne({ _id: staffData._id }, { $set: { openid } });
      }
    } else if (type === 'refresh') {
      const { token } = body;
      const payload = await verifyMiniProgramToken(token);
      if (!payload) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
      }

      // Re-fetch fresh data to ensure role/enterprise still valid
      // 兼容具体的业务角色
      const isStaff = payload.role !== 'user';
      if (isStaff) {
        staffData = await AdminUser.findById(payload.id);
        if (!staffData || staffData.status !== 'active') {
           return NextResponse.json({ success: false, error: 'Staff account disabled' }, { status: 403 });
        }
        userId = staffData._id.toString();
        role = 'staff';
      } else {
        userData = await User.findById(payload.id);
        if (!userData) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
        userId = userData._id.toString();
        role = 'user';
      }
      loginSource = payload.source as any;
    } else {
      return NextResponse.json({ success: false, error: 'Invalid login method' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Auth failed' }, { status: 401 });
    }

    // Prepare response data
    let enterpriseName = '';
    if (staffData?.enterpriseId) {
      const ent = await Enterprise.findById(staffData.enterpriseId);
      enterpriseName = ent?.name || '';
    }

    const finalUser = {
      nickname: userData?.nickname || staffData?.displayName || staffData?.username || '用户',
      avatar: userData?.avatar || '',
      phone: userData?.phone || staffData?.phone || '',
      role: role,
      staffRole: staffData?.role || '',
      staffPermissions: staffData ? getEffectivePermissions(staffData.role, staffData.menuPermissions) : [],
      enterpriseId: staffData?.enterpriseId?.toString() || '',
      enterpriseName,
      staffId: staffData?._id?.toString() || '',
      workbenchType: getWorkbenchType(staffData?.role),
    };

    // 关键修复：如果是员工，Token 中的 id 必须是 AdminUser 的 ID
    const jwtId = (role === 'staff' && staffData) ? staffData._id.toString() : userId;

    const token = await signMiniProgramToken({
      id: jwtId,
      // 关键修复：将具体的业务角色写入 role 字段，以便 auth.ts 正确识别
      role: (role === 'staff' && staffData?.role) ? staffData.role : role,
      staffRole: staffData?.role,
      enterpriseId: staffData?.enterpriseId?.toString(),
      openid: userData?.openid || staffData?.openid,
      source: loginSource
    });

    return NextResponse.json({
      success: true,
      token,
      openid: userData?.openid || staffData?.openid || `staff_${userId}`,
      user: {
        ...finalUser,
        openid: userData?.openid || staffData?.openid || `staff_${userId}`
      }
    });

  } catch (error: any) {
    console.error('[UnifiedAuth] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
