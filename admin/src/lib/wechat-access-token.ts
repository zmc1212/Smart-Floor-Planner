const ACCESS_TOKEN_SKEW_MS = 200_000;

let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0;

function wechatCredentials() {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing');
  }
  return { appId, appSecret };
}

export async function getWechatAccessToken(options: {
  fetchImpl?: typeof fetch;
  now?: number;
} = {}) {
  const now = options.now ?? Date.now();
  if (cachedAccessToken && accessTokenExpiresAt > now) {
    return cachedAccessToken;
  }

  const { appId, appSecret } = wechatCredentials();
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
  );
  const data = await response.json();
  if (!response.ok || data.errcode || !data.access_token) {
    throw new Error(data.errmsg || 'Unable to obtain WeChat access token');
  }

  cachedAccessToken = data.access_token as string;
  accessTokenExpiresAt =
    now + Math.max(1, Number(data.expires_in) * 1000 - ACCESS_TOKEN_SKEW_MS);
  return cachedAccessToken;
}

export function resetWechatAccessTokenCacheForTests() {
  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
}
