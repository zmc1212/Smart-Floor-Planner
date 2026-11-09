const KEY = 'assistant-active-conversation-v1';
const CONVERSATION_ID = /^[1-9]\d{0,18}$/;

function read() {
  try {
    const saved = wx.getStorageSync(KEY);
    const id = saved && String(saved.id || '');
    return CONVERSATION_ID.test(id) ? id : '';
  } catch (_) { return ''; }
}

function save(id) {
  const value = String(id == null ? '' : id);
  if (!CONVERSATION_ID.test(value)) return;
  try { wx.setStorageSync(KEY, { id: value }); } catch (_) { /* The open page keeps its in-memory conversation. */ }
}

function clear(id) {
  try {
    const saved = wx.getStorageSync(KEY);
    if (id == null || String(saved && saved.id) === String(id)) wx.removeStorageSync(KEY);
  } catch (_) { /* Storage failures keep the in-memory conversation usable. */ }
}

// Deep links, follow-up views and activity/public-site entries own their entry
// context; only the plain customer Tab entry resumes the remembered chat.
function resumeId(options) {
  return Object.keys(options || {}).length ? '' : read();
}

module.exports = { KEY, read, save, clear, resumeId };
