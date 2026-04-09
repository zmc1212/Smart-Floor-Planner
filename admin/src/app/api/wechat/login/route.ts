import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { User } from '@/models/User';

export async function POST(req: Request) {
  try {
    const { code } = await req.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Missing code' },
        { status: 400 }
      );
    }

    const appId = process.env.WX_APPID;
    const appSecret = process.env.WX_APPSECRET;

    if (!appId || !appSecret) {
      console.error("Missing WeChat AppID or AppSecret in environment variables.");
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    // Call WeChat jscode2session API
    const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;
    const response = await fetch(wxApiUrl);
    const data = await response.json();

    if (data.errcode) {
      console.error("WeChat API Error:", data);
      return NextResponse.json({ error: data.errmsg }, { status: 400 });
    }

    const { openid, session_key } = data;

    // Connect to DB and find/create user
    await dbConnect();
    
    let user = await User.findOne({ openid });
    
    if (!user) {
      // Register new user on first login
      user = new User({ openid, role: 'user' });
      await user.save();
    }

    // Usually you'd issue a JWT here, but for simplicity, returning the openid direct (and user data).
    // The Mini Program will use the returned openid to update profile info subsequently.
    return NextResponse.json({
      success: true,
      openid: user.openid,
      user: {
        nickname: user.nickname || '',
        avatar: user.avatar || '',
        communityName: user.communityName || '',
      }
    });

  } catch (error: any) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
