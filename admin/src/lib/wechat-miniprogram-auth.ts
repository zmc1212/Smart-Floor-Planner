import { createDecipheriv } from 'node:crypto';
import {
  getWechatAccessToken,
  invalidateWechatAccessTokenCache,
} from '@/lib/wechat-access-token';
import { normalizeCustomerPhone } from '@/lib/customer-phone';

export interface WechatSessionIdentity {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

export interface WechatPhoneIdentity {
  openid: string;
  unionid?: string;
  phone: string;
}

function wechatCredentials() {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }
  return { appId, appSecret };
}

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getWechatSessionIdentity(
  code: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<WechatSessionIdentity> {
  const { appId, appSecret } = wechatCredentials();
  if (!code) throw new Error('WeChat login code is required');
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`
  );
  const data = await response.json();
  if (data.errcode || !data.openid) {
    throw new Error(data.errmsg || 'WeChat API error');
  }
  return {
    openid: data.openid,
    unionid: data.unionid,
    sessionKey:
      typeof data.session_key === 'string' && data.session_key
        ? data.session_key
        : undefined,
  };
}

export function decryptWechatEncryptedPhoneNumber(input: {
  encryptedData: string;
  iv: string;
  sessionKey: string;
}) {
  const { appId } = wechatCredentials();
  let sessionKey: Buffer;
  let iv: Buffer;
  let encrypted: Buffer;
  try {
    sessionKey = Buffer.from(input.sessionKey, 'base64');
    iv = Buffer.from(input.iv, 'base64');
    encrypted = Buffer.from(input.encryptedData, 'base64');
  } catch {
    throw new Error('Unable to obtain WeChat phone number');
  }
  if (sessionKey.length !== 16 || iv.length !== 16 || encrypted.length < 16) {
    throw new Error('Unable to obtain WeChat phone number');
  }

  let decoded: string;
  try {
    const decipher = createDecipheriv('aes-128-cbc', sessionKey, iv);
    decoded = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to obtain WeChat phone number');
  }

  let data: {
    phoneNumber?: string;
    purePhoneNumber?: string;
    watermark?: { appid?: string };
  };
  try {
    data = JSON.parse(decoded);
  } catch {
    throw new Error('Unable to obtain WeChat phone number');
  }
  if (data.watermark?.appid !== appId) {
    throw new Error('Unable to obtain WeChat phone number');
  }
  const rawPhone = data.purePhoneNumber || data.phoneNumber;
  if (!rawPhone) {
    throw new Error('Unable to obtain WeChat phone number');
  }
  return normalizeCustomerPhone(rawPhone);
}

export function hasDirectWechatPhoneAuthorization(body: {
  loginCode?: unknown;
  phoneCode?: unknown;
  encryptedData?: unknown;
  iv?: unknown;
}) {
  if (!asTrimmedString(body.loginCode)) return false;
  if (asTrimmedString(body.phoneCode)) return true;
  return Boolean(
    asTrimmedString(body.encryptedData) && asTrimmedString(body.iv)
  );
}

export async function resolveWechatPhoneLogin(
  body: {
    loginCode?: unknown;
    phoneCode?: unknown;
    encryptedData?: unknown;
    iv?: unknown;
  },
  options: { fetchImpl?: typeof fetch } = {}
): Promise<WechatPhoneIdentity> {
  const loginCode = asTrimmedString(body.loginCode);
  const phoneCode = asTrimmedString(body.phoneCode);
  const encryptedData = asTrimmedString(body.encryptedData);
  const iv = asTrimmedString(body.iv);
  if (!loginCode) throw new Error('WeChat login code is required');

  if (phoneCode) {
    const [wechat, phone] = await Promise.all([
      getWechatSessionIdentity(loginCode, options),
      getWechatPhoneNumber(phoneCode, options),
    ]);
    return { openid: wechat.openid, unionid: wechat.unionid, phone };
  }

  if (encryptedData && iv) {
    const wechat = await getWechatSessionIdentity(loginCode, options);
    if (!wechat.sessionKey) {
      throw new Error('WeChat session key is required');
    }
    const phone = decryptWechatEncryptedPhoneNumber({
      encryptedData,
      iv,
      sessionKey: wechat.sessionKey,
    });
    return { openid: wechat.openid, unionid: wechat.unionid, phone };
  }

  throw new Error('WeChat phone code is required');
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
