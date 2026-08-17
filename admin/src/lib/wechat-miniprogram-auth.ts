import { getWechatAccessToken } from '@/lib/wechat-access-token';

export interface WechatSessionIdentity {
  openid: string;
  unionid?: string;
}

function wechatCredentials() {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }
  return { appId, appSecret };
}

export async function getWechatSessionIdentity(
  code: string
): Promise<WechatSessionIdentity> {
  const { appId, appSecret } = wechatCredentials();
  if (!code) throw new Error('WeChat login code is required');

  const response = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`
  );
  const data = await response.json();
  if (data.errcode || !data.openid) {
    throw new Error(data.errmsg || 'WeChat API error');
  }
  return { openid: data.openid, unionid: data.unionid };
}

export async function getWechatPhoneNumber(phoneCode: string) {
  if (!phoneCode) throw new Error('WeChat phone code is required');
  const accessToken = await getWechatAccessToken();

  const phoneRes = await fetch(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: phoneCode }),
    }
  );
  const phoneData = await phoneRes.json();
  if (phoneData.errcode !== 0 || !phoneData.phone_info?.phoneNumber) {
    throw new Error(phoneData.errmsg || 'Unable to obtain WeChat phone number');
  }
  return phoneData.phone_info.phoneNumber as string;
}
