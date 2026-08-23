import {
  getWechatAccessToken,
  invalidateWechatAccessTokenCache,
} from '@/lib/wechat-access-token';
import { normalizeCustomerPhone } from '@/lib/customer-phone';

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

function isInvalidAccessTokenError(phoneData: {
  errcode?: number;
  errmsg?: string;
}) {
  return (
    phoneData.errcode === 40001 ||
    phoneData.errcode === 40014 ||
    phoneData.errcode === 42001
  );
}

export async function getWechatPhoneNumber(
  phoneCode: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  if (!phoneCode) throw new Error('WeChat phone code is required');
  const fetchImpl = options.fetchImpl ?? fetch;

  const requestPhone = async (accessToken: string) => {
    const phoneRes = await fetchImpl(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: phoneCode }),
      }
    );
    return phoneRes.json();
  };

  let accessToken = await getWechatAccessToken({ fetchImpl });
  let phoneData = await requestPhone(accessToken);
  if (isInvalidAccessTokenError(phoneData)) {
    invalidateWechatAccessTokenCache();
    accessToken = await getWechatAccessToken({ fetchImpl });
    phoneData = await requestPhone(accessToken);
  }
  const phoneInfo = phoneData.phone_info as {
    phoneNumber?: string;
    purePhoneNumber?: string;
  } | undefined;
  const rawPhone = phoneInfo?.purePhoneNumber || phoneInfo?.phoneNumber;
  if (phoneData.errcode !== 0 || !rawPhone) {
    throw new Error(phoneData.errmsg || 'Unable to obtain WeChat phone number');
  }
  return normalizeCustomerPhone(rawPhone);
}
