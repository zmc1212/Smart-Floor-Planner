const { errorCopy, uncertain } = require('../lib/client');

const messageActionItems = [
  { id: 'edit', text: '修改', icon: 'message-actions/edit', needsIdle: true },
  { id: 'copy', text: '复制', icon: 'message-actions/copy' },
  { id: 'share', text: '分享', icon: 'message-actions/share' },
  { id: 'quote', text: '引用', icon: 'message-actions/quote', needsIdle: true },
  { id: 'delete', text: '删除', icon: 'message-actions/delete', needsIdle: true },
];

const initialMessageActions = () => ({ messageMenu: null, messageActionItems, messageShare: null, messageShareBusy: false, messageShareError: '' });
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function messageMenuLayout(bubble, viewport, width) {
  const gap = 9, inset = 14, panelWidth = 160;
  const firstY = Math.max(0, viewport.top), lastY = viewport.bottom;
  const sourceTop = Math.max(firstY, bubble.top), sourceBottom = Math.min(lastY, bubble.bottom);
  const panelHeight = Math.min(234, lastY - firstY - 8);
  if (sourceBottom <= sourceTop || panelHeight < 44) return null;

  const below = lastY - sourceBottom, above = sourceTop - firstY;
  const opensUp = below < panelHeight + gap && above > below;
  const left = clamp(bubble.right - panelWidth, inset, width - panelWidth - inset);
  const top = clamp(opensUp ? sourceTop - gap - panelHeight : sourceBottom + gap, firstY + 4, lastY - panelHeight - 4);
  return {
    left, top, panelHeight, opensUp,
    pointer: clamp(bubble.right - left - 26, 14, panelWidth - 22),
    sourceLeft: bubble.left, sourceTop, sourceWidth: bubble.width, sourceHeight: sourceBottom - sourceTop,
    sourceOffset: bubble.top - sourceTop,
  };
}

function nativeCall(receiver, method, data) {
  return new Promise((resolve, reject) => receiver[method]({ ...data, success: resolve, fail: reject }));
}

const messageActionsMethods = {
  openMessageMenu(id) {
    const text = this.controller.questionText(id);
    if (!text || !this._alive || !this._shown || this.data.sheet || this.data.followupActive) return;
    const cid = this.controller.conversationId;
    const request = this._messageMenuRequest = (this._messageMenuRequest || 0) + 1;
    const query = this.createSelectorQuery ? this.createSelectorQuery() : wx.createSelectorQuery();
    query.select('#message-' + id + ' .bubble').boundingClientRect();
    query.select('.conversation-scroll').boundingClientRect();
    query.exec(([bubble, viewport]) => {
      if (!this._alive || !this._shown || this.data.sheet || this._messageMenuRequest !== request
        || cid !== this.controller.conversationId || this.controller.questionText(id) !== text || !bubble || !viewport) return;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const layout = messageMenuLayout(bubble, viewport, info.windowWidth);
      if (!layout) return;
      const quote = this.data.messages.find(item => item.id === id)?.messageQuote;
      this._replyScroll?.hold();
      this.setData({ messageMenu: { id, text, quote, ...layout } });
    });
  },

  closeMessageMenu() {
    this._messageMenuRequest = (this._messageMenuRequest || 0) + 1;
    if (this.data.messageMenu) this.setData({ messageMenu: null });
  },

  async chooseMessageAction(event) {
    const menu = this.data.messageMenu;
    const action = messageActionItems.find(item => item.id === event.currentTarget.dataset.action);
    if (!menu || !action || !this._alive || !this._shown) return;
    const { id } = menu;
    const text = this.controller.questionText(id);
    this.closeMessageMenu();
    if (!text) return;
    if (action.needsIdle && (!this.data.canSend || this.data.busy || this.data.pendingSend
      || this.data.pendingAction || this.data.generating)) return;
    if (action.id === 'edit') return this.editQuestionText(id);
    if (action.id === 'copy') {
      return wx.setClipboardData({ data: text, showToast: false,
        success: () => { if (this._shown) wx.showToast({ title: '已复制', icon: 'none' }); },
        fail: () => { if (this._shown) wx.showToast({ title: '复制失败，请重试', icon: 'none' }); },
      });
    }
    if (action.id === 'share') {
      this.setData({ messageShare: { id, text, conversationId: this.controller.conversationId }, messageShareError: '' });
      return this.openSheet('messageShare');
    }
    if (action.id === 'quote') {
      if (this.controller.setMessageQuote(id)) this.clearStageInput();
      return;
    }
    return this.confirmDeleteQuestion(id, text);
  },

  clearMessageQuote() { this.controller.setMessageQuote(); },

  async confirmDeleteQuestion(id, text) {
    const conversationId = this.controller.conversationId;
    const serverPending = this.controller.client.pending.has('question-delete:' + conversationId + ':' + id);
    const current = () => this._alive && this._shown && this.controller.conversationId === conversationId
      && this.controller.questionText(id) === text;
    try {
      if (!serverPending) {
        const choice = await nativeCall(wx, 'showModal', { title: '删除这条消息？',
          content: '原消息将从对话中移除，指向它的引用将失效。', confirmText: '删除', confirmColor: '#A7443B' });
        if (!choice.confirm) return;
      }
      if (current() && await this.controller.deleteQuestion(id) && this._shown && this.controller.conversationId === conversationId)
        wx.showToast({ title: '已删除', icon: 'none' });
    } catch (error) {
      if (current()) wx.showToast({ title: uncertain(error) ? '删除结果待确认，请重试' : errorCopy(error), icon: 'none' });
    }
  },

  async shareSelectedMessage() {
    const selected = this.data.messageShare;
    if (!selected || this.data.sheet !== 'messageShare' || this.data.messageShareBusy) return;
    const current = () => this._alive && this._shown && this.data.sheet === 'messageShare' && this.data.messageShare?.id === selected.id
      && this.controller.conversationId === selected.conversationId && this.controller.questionText(selected.id) === selected.text;
    if (!current()) return this.closeSheet();
    if (!wx.shareFileMessage || !wx.getFileSystemManager || !wx.env?.USER_DATA_PATH) {
      this.setData({ messageShareError: '当前微信环境暂不支持分享，可以复制文字。' });
      return;
    }
    const files = wx.getFileSystemManager();
    const filePath = wx.env.USER_DATA_PATH + '/xiaok-message-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '.txt';
    this.setData({ messageShareBusy: true, messageShareError: '' });
    try {
      await nativeCall(files, 'writeFile', { filePath, data: selected.text, encoding: 'utf8' });
      if (!current()) return;
      await nativeCall(wx, 'shareFileMessage', { filePath, fileName: '小K聊天消息.txt' });
      if (current()) this.closeSheet();
    } catch (error) {
      if (current() && !/cancel/i.test(error?.errMsg || '')) this.setData({ messageShareError: '分享未打开，请重试。' });
    } finally {
      files.unlink({ filePath, fail() {} });
      if (current()) this.setData({ messageShareBusy: false });
    }
  },
};

module.exports = { initialMessageActions, messageActionsMethods, messageMenuLayout };
