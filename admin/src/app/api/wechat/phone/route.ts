import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';

// Simple in-memory cache for access token
let cachedToken: { token: string, expiresAt: number } | null = null;

async function getAccessToken(appId: string, appSecret: string) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const response = await fetch(tokenUrl);
  const data = await response.json();

  if (data.errcode) {
    throw new Error(data.errmsg || 'Failed to get access token');
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: now + ((data.expires_in || 7200) - 200) * 1000
  };

  return cachedToken.token;
}

/**
 * Combined phone login endpoint.
 * Accepts:
 *   - loginCode: from wx.login() to get openid
 *   - phoneCode: from getPhoneNumber button to get phone number
 * 
 * Flow:
 *   1. Use loginCode -> WeChat jscode2session -> openid
 *   2. Use phoneCode -> WeChat getuserphonenumber -> phone
 *   3. Find or create user with openid + phone
 *   4. Return user data
 */
export async function POST(req: Request) {
  try {
    const { loginCode, phoneCode } = await req.json();

    if (!loginCode || !phoneCode) {
      return NextResponse.json(
        { error: 'Missing loginCode or phoneCode' },
        { status: 400 }
      );
    }

    const appId = process.env.WX_APPID;
    const appSecret = process.env.WX_APPSECRET;

    if (!appId || !appSecret) {
      console.error("Missing WeChat AppID or AppSecret");
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    // ---- Step 1: Get openid via jscode2session ----
    const wxLoginUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${loginCode}&grant_type=authorization_code`;
    const loginRes = await fetch(wxLoginUrl);
    const loginData = await loginRes.json();

    if (loginData.errcode) {
      console.error("WeChat jscode2session Error:", loginData);
      return NextResponse.json({ error: loginData.errmsg || 'WeChat login error' }, { status: 400 });
    }

    const { openid } = loginData;
    console.log(`Phone login: got openid ${openid}`);

    // ---- Step 2: Get phone number ----
    const accessToken = await getAccessToken(appId, appSecret);
    const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`;
    const phoneRes = await fetch(phoneUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: phoneCode }),
    });

    const phoneData = await phoneRes.json();
    console.log('WeChat Phone API response:', JSON.stringify(phoneData));

    if (phoneData.errcode !== 0) {
      console.error("WeChat Phone Error:", phoneData);
      return NextResponse.json({ error: phoneData.errmsg || 'Failed to get phone number' }, { status: 400 });
    }

    if (!phoneData.phone_info || !phoneData.phone_info.phoneNumber) {
      console.error("No phone info in response:", phoneData);
      return NextResponse.json({ error: 'Phone info not available' }, { status: 400 });
    }

    const phoneNumber = phoneData.phone_info.phoneNumber;
    console.log(`Phone login: got phone ${phoneNumber} for openid ${openid}`);

    // ---- Step 3: Find or create user and link Professional Profile ----
    await dbConnect();

    // Check if this user is a Staff Member (AdminUser)
    const staff = await AdminUser.findOne({ $or: [{ phone: phoneNumber }, { openid }] });
    let enterpriseName = '';
    let isStaff = false;

    if (staff) {
      isStaff = true;
      // Link openid if not already linked
      if (!staff.openid) {
        staff.openid = openid;
        await staff.save();
      }
      // Get Enterprise Name
      if (staff.enterpriseId) {
        const ent = await Enterprise.findById(staff.enterpriseId);
        enterpriseName = ent?.name || '';
      }
    }

    let user = await User.findOne({ openid });
    if (!user) {
      user = new User({ openid, phone: phoneNumber, role: isStaff ? 'staff' : 'user' });
      await user.save();
    } else {
      user.phone = phoneNumber;
      if (isStaff) user.role = 'staff';
      await user.save();
    }

    // ---- Step 4: Return user data ----
    return NextResponse.json({
      success: true,
      openid: user.openid,
      user: {
        nickname: user.nickname || staff?.displayName || '',
        avatar: user.avatar || '',
        communityName: user.communityName || '',
        phone: user.phone || '',
        role: user.role,
        enterpriseId: staff?.enterpriseId || '',
        enterpriseName: enterpriseName,
        staffId: staff?._id || ''
      }
    });

  } catch (error: any) {
    console.error("Phone Login Error:", error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
