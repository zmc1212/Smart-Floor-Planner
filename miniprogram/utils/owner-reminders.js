const api = require('./api');

const base = '/miniprogram/xiaok/reminders/owner';
const options = { suppressUnauthorized: true };
let cachedSummary = null;
let pendingSummary = null;

function sessionToken() {
  return getApp().globalData.token || wx.getStorageSync('token') || '';
}

function summary() {
  return cachedSummary?.token === sessionToken() ? cachedSummary.data : null;
}

function updateNav() {
  const page = typeof getCurrentPages === 'function' && getCurrentPages().slice(-1)[0];
  page?.selectComponent?.('#customer-nav')?.syncReminderBadge?.();
}

function refreshSummary(force = false) {
  const token = sessionToken();
  if (!token) return Promise.resolve(null);
  if (!force && pendingSummary?.token === token) return pendingSummary.promise;
  const request = { token };
  pendingSummary = request;
  const current = () => pendingSummary === request && sessionToken() === token;
  request.promise = api.request(base, 'GET', {}, options).then(({ data }) => {
    if (!current()) return null;
    cachedSummary = { token, data };
    updateNav();
    return data;
  }).catch(error => {
    if (current() && [401, 403].includes(error.statusCode)) {
      cachedSummary = null;
      updateNav();
    }
    return null;
  }).finally(() => { if (pendingSummary === request) pendingSummary = null; });
  return request.promise;
}

async function claimPrompt({ projectId, reminderId }) {
  const { data } = await api.request(base, 'POST', { action: 'prompt', projectId, reminderId }, options);
  return data.prompt;
}

async function list(projectId) {
  const { data } = await api.request(`${base}?projectId=${encodeURIComponent(projectId)}`, 'GET', {}, options);
  return data.items;
}

async function read({ projectId, reminderId }) {
  const token = sessionToken();
  try {
    const { data } = await api.request(base, 'POST', { action: 'read', projectId, reminderId }, options);
    return data.item;
  } finally {
    if (sessionToken() === token) void refreshSummary(true);
  }
}

function readError(error) {
  if ([401, 403, 404].includes(error.statusCode)) return '这条提醒当前不可查看。';
  return '提醒暂时无法读取，请重试。';
}

module.exports = { sessionToken, summary, refreshSummary, claimPrompt, list, read, readError };
