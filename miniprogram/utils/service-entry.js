const FREE_DESIGN_ROUTE = 'packages/business/free-design-service/free-design-service';
const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';
const ACQUISITION_ROUTE = 'packages/business/acquisition-chat/acquisition-chat';
const PROMOTION_CODE = /^(rp_|sa_)?[A-Za-z0-9_-]{32}$/;

function serviceEntryCode(value) {
  try {
    const code = decodeURIComponent(String(value || '').trim());
    return PROMOTION_CODE.test(code) ? code : '';
  } catch (_) { return ''; }
}

async function openPromotionChat(code, fail) {
  const app = getApp();
  if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
  const mode = app.globalData.bootstrap?.current?.mode || app.globalData.userInfo?.mode;
  const query = '?promotionCode=' + encodeURIComponent(code);
  if (mode && mode !== 'customer') wx.redirectTo({ url: '/packages/assistant/chat/chat' + query, fail });
  else wx.reLaunch({ url: '/pages/index/index' + query, fail });
}

function resolveServiceEntryUrl(scanResult, { assistant = false } = {}) {
  const candidates = [scanResult?.path, scanResult?.result].map(value => String(value || '').trim()).filter(Boolean);
  for (const raw of candidates) {
    if (assistant && /^(rp_|sa_)/.test(raw) && serviceEntryCode(raw)) return `/${ACQUISITION_ROUTE}?entryCode=${raw}`;
    let path = raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        path = url.pathname + url.search;
      }
    } catch (_) { continue; }
    const [route, query = ''] = path.replace(/^\/+/, '').split(/\?(.*)/);
    const name = route.replace(/\.html$/, '');
    const entry = /(?:^|&)(entryCode|token|scene)=([^&]+)/.exec(query);
    if (!entry) continue;
    if (assistant) {
      if (name !== ACQUISITION_ROUTE && name !== FREE_DESIGN_ROUTE) continue;
      const token = serviceEntryCode(entry[2]);
      if (token) return `/${ACQUISITION_ROUTE}?entryCode=${encodeURIComponent(token)}`;
    } else if (name === ACQUISITION_ROUTE || name === FREE_DESIGN_ROUTE || name === ONBOARDING_ROUTE) {
      return `/${name}?${query}`;
    }
  }
  return '';
}

module.exports = { resolveServiceEntryUrl, serviceEntryCode, openPromotionChat };
