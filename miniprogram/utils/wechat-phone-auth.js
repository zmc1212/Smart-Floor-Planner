let cachedLoginCode = '';
let inflight = null;

function resetWechatLoginCodeForTests() {
  cachedLoginCode = '';
  inflight = null;
}

function refreshWechatLoginCode() {
  if (typeof wx === 'undefined' || typeof wx.login !== 'function') {
    return Promise.resolve('');
  }
  if (inflight) return inflight;
  inflight = new Promise((resolve) => {
    wx.login({
      success(result) {
        cachedLoginCode = result && result.code ? String(result.code) : '';
        resolve(cachedLoginCode);
      },
      fail() {
        cachedLoginCode = '';
        resolve('');
      },
      complete() {
        inflight = null;
      }
    });
  });
  return inflight;
}

function takeWechatLoginCode() {
  const code = cachedLoginCode;
  cachedLoginCode = '';
  return code;
}

function readWechatPhoneAuth(detail) {
  const errMsg = String((detail && (detail.errMsg || detail.errmsg)) || '');
  if (!detail || errMsg !== 'getPhoneNumber:ok') {
    return { ok: false, reason: 'denied', detail };
  }
  const phoneCode = String(detail.code || '').trim();
  if (phoneCode) {
    return { ok: true, kind: 'code', phoneCode };
  }
  const encryptedData = String(detail.encryptedData || '').trim();
  const iv = String(detail.iv || '').trim();
  if (encryptedData && iv) {
    return { ok: true, kind: 'encrypted', encryptedData, iv };
  }
  return { ok: false, reason: 'missing', detail };
}

function resolveWechatPhoneLoginInput(detail) {
  const auth = readWechatPhoneAuth(detail);
  if (!auth.ok) return auth;
  if (auth.kind === 'code') return auth;
  const loginCode = takeWechatLoginCode();
  refreshWechatLoginCode();
  if (!loginCode) {
    return { ok: false, reason: 'session', detail };
  }
  return {
    ok: true,
    kind: 'encrypted',
    loginCode,
    encryptedData: auth.encryptedData,
    iv: auth.iv
  };
}

function wechatPhoneAuthToast(reason, fallback) {
  if (reason === 'denied') return fallback || '已取消授权';
  if (reason === 'session') return '请再点一次授权';
  return fallback || '获取手机号失败';
}

module.exports = {
  refreshWechatLoginCode,
  takeWechatLoginCode,
  readWechatPhoneAuth,
  resolveWechatPhoneLoginInput,
  wechatPhoneAuthToast,
  resetWechatLoginCodeForTests
};
