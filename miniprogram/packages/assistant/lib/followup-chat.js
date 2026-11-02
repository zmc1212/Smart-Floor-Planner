const shared = require('../../../utils/assistant-followup-chat');
const KEY = 'assistant-followup-drafts-v1';
class FollowupChat extends shared.FollowupChat {
  drafts(text) {
    if (!this.session || this.identity() !== this.session) return;
    try {
      const saved = wx.getStorageSync(KEY), key = this.bid + ':' + this.cid, now = Date.now();
      const items = saved?.session === this.session && Array.isArray(saved.items) ? saved.items.filter(d => now - d.at < 604800000) : [];
      if (text === undefined) return items.find(d => d.key === key)?.text;
      const next = items.filter(d => d.key !== key);
      if (text) next.push({ key, text, at: now });
      wx.setStorageSync(KEY, { session: this.session, items: next.slice(-20) });
    } catch { /* Keep the live draft when local storage is unavailable. */ }
  }
  set(patch) {
    super.set(patch);
    if (this.visible && patch.fatal) this.drafts('');
    else if (this.visible && this.state.conversation?.id === this.cid && Object.prototype.hasOwnProperty.call(patch, 'draft')) this.drafts(this.state.draft);
  }
  async open(context) {
    await super.open(context);
    if (this.visible && this.state.canDraft && !this.state.draft && !this.state.pendingSend) {
      const text = this.drafts();
      if (text) this.chat.input(text);
    }
  }
}
module.exports = { ...shared, FollowupChat };
