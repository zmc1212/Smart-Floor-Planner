const ACCESS_TOKEN_SKEW_MS = 360_000;

let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0;

function wechatCredentials() {
  const appId = process.env.WX_APPID;
  const appSecret = process.env.WX_APPSECRET;
  if (!appId || !appSecret) {
    throw Object.assign(new Error('Server misconfiguration: WX_APPID or WX_APPSECRET missing'), { code: 'WX_CONFIG_MISSING' });
  }
  return { appId, appSecret };
}

export function invalidateWechatAccessTokenCache() {
  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
}

export async function getWechatAccessToken(options: {
  fetchImpl?: typeof fetch;
  now?: number;
  forceRefresh?: boolean;
} = {}) {
  const now = options.now ?? Date.now();
  if (!options.forceRefresh && cachedAccessToken && accessTokenExpiresAt > now) {
    return cachedAccessToken;
  }

  const { appId, appSecret } = wechatCredentials();
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
      force_refresh: Boolean(options.forceRefresh),
    }),
  });
  const data = await response.json();
  if (!response.ok || data.errcode || !data.access_token) {
    throw Object.assign(new Error(data.errmsg || 'Unable to obtain WeChat access token'), { code: data.errcode });
  }

  cachedAccessToken = data.access_token as string;
  accessTokenExpiresAt =
    now + Math.max(1, Number(data.expires_in) * 1000 - ACCESS_TOKEN_SKEW_MS);
  return cachedAccessToken;
}

export function resetWechatAccessTokenCacheForTests() {
  invalidateWechatAccessTokenCache();
}
