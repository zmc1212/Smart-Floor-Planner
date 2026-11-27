const { aiEntriesEnabled } = require('./ai-entries');
const { canAccessRoute, roleForIdentity } = require('./identity-navigation');

let continuation;
let sequence = 0;

function liveContinuation(id, originPage) {
  if (continuation?.id !== id || continuation.originPage !== originPage) return null;
  if (continuation.expiresAt <= Date.now()) {
    continuation = null;
    return null;
  }
  return continuation;
}

function openQuestionLogin(origin, text, revision) {
  const originPage = getCurrentPages().at(-1);
  if (!originPage || !text.trim()) return false;
  if (continuation?.origin === origin && liveContinuation(continuation.id, originPage)) return true;
  const id = Date.now().toString(36) + '-' + (++sequence).toString(36);
  continuation = { id, origin, originPage, text, revision, expiresAt: Date.now() + 30 * 60 * 1000 };
  wx.navigateTo({
    url: '/packages/business/login/login?questionResume=' + id,
    fail() {
      if (continuation?.id === id) continuation = null;
      wx.showToast({ title: '登录页暂时无法打开，请重试', icon: 'none' });
    },
  });
  return true;
}

function previewQuestion(id, originPage) {
  return liveContinuation(id, originPage)?.text || '';
}

function authorizeQuestionReturn(id, originPage, state) {
  const item = liveContinuation(id, originPage);
  if (!item) return false;
  const context = state.bootstrap?.current;
  const identity = context?.context || state.userInfo;
  const mode = context?.mode || identity?.mode;
  if (!context || !state.token || !aiEntriesEnabled(state) || (mode ? mode !== 'customer' : roleForIdentity(identity) !== 'customer')
    || !canAccessRoute(originPage.route, state.bootstrap || identity)) {
    continuation = null;
    return false;
  }
  item.token = state.token;
  return true;
}

function takeQuestion(origin, token, revision) {
  const item = continuation;
  if (item?.origin !== origin || !item.token) return '';
  continuation = null;
  return item.token === token && item.revision === revision && item.expiresAt > Date.now() ? item.text : '';
}

function dismissQuestionLogin(id, leavingAfterSuccess = false) {
  if (continuation?.id === id && (!leavingAfterSuccess || !continuation.token)) continuation = null;
}

function clearQuestionFor(origin) {
  if (continuation?.origin === origin) continuation = null;
}

module.exports = { openQuestionLogin, previewQuestion, authorizeQuestionReturn, takeQuestion, dismissQuestionLogin, clearQuestionFor };
