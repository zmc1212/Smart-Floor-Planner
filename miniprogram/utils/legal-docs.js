const LEGAL_WEBVIEW_ROUTE = '/packages/business/legal-webview/legal-webview';

const LEGAL_DOCS = Object.freeze({
  user: {
    title: '用户协议',
    url: 'https://smartfloor.zlyun168.com/user-agreement.html'
  },
  privacy: {
    title: '隐私政策',
    url: 'https://smartfloor.zlyun168.com/privacy-policy.html'
  },
  disclaimer: {
    title: '免责协议',
    url: 'https://smartfloor.zlyun168.com/disclaimer.html'
  }
});

function isHttpsUrl(value) {
  const raw = String(value || '').trim();
  return /^https:\/\/\S+$/i.test(raw);
}

function encodeQueryValue(value) {
  return encodeURIComponent(encodeURIComponent(String(value || '')));
}

function decodeQueryValue(value) {
  let raw = String(value || '');
  if (!raw) return '';
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(raw)) break;
    try {
      const next = decodeURIComponent(raw);
      if (next === raw) break;
      raw = next;
    } catch (_error) {
      break;
    }
  }
  return raw;
}

function resolveLegalDoc(kind) {
  const doc = LEGAL_DOCS[kind];
  return doc ? { kind, title: doc.title, url: doc.url } : null;
}

function buildLegalWebviewUrl(doc) {
  if (!doc || !isHttpsUrl(doc.url)) return null;
  return `${LEGAL_WEBVIEW_ROUTE}?url=${encodeQueryValue(doc.url)}&title=${encodeQueryValue(doc.title || '查看文档')}`;
}

function parseWebviewOptions(options) {
  const title = decodeQueryValue(options && options.title) || '查看文档';
  const url = decodeQueryValue(options && options.url);
  return {
    title,
    url: isHttpsUrl(url) ? url : ''
  };
}

module.exports = {
  LEGAL_DOCS,
  LEGAL_WEBVIEW_ROUTE,
  isHttpsUrl,
  resolveLegalDoc,
  buildLegalWebviewUrl,
  parseWebviewOptions
};
