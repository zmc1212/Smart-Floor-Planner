const { RequirementsController, initial } = require('../lib/requirements');
const { goToLogin } = require('../../../utils/session');

Page({
  data: { ...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100 },
  onLoad(options) {
    this.options = options || {}; this.alive = true;
    this.measureWindow();
    this.controller = new RequirementsController({
      identity: () => getApp().globalData.token || wx.getStorageSync('token') || '',
      emit: patch => {
        if (!this.alive) return;
        this.setData(patch);
        if (this.data.dirty || this.data.pending) {
          if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '需求修改尚未确认保存，离开后请重新核对。' });
        } else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      },
    });
  },
  async onShow() {
    this.shown = true;
    const app = getApp();
    if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
    if (this.alive && this.shown) await this.controller.show(this.options.conversationId);
  },
  onHide() { this.shown = false; },
  onUnload() { this.alive = false; this.controller.dispose(); },
  onResize() { this.measureWindow(); },
  measureWindow() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { capsule = null; }
    const navigationHeight = Math.max(44, capsule && capsule.height || 32);
    this.setData({ navigationHeight,
      navigationTop: Math.max(info.statusBarHeight || 24, (capsule && capsule.top || info.statusBarHeight || 24) + ((capsule && capsule.height || 32) - navigationHeight) / 2),
      navigationRight: Math.max(96, info.windowWidth - (capsule && capsule.left || info.windowWidth - 96) + 10),
    });
  },
  async edit(event) {
    const controller = this.controller, key = event.currentTarget.dataset.key;
    if (!this.data.proposal) return controller.edit(key);
    const context = controller.proposalContext();
    if (!context || !this.data.rows.some(row => row.key === key && row.proposalChange)) return;
    const result = await new Promise(resolve => wx.showActionSheet({ itemList: ['保留原需求', '采用本次提案'],
      success: resolve, fail: () => resolve(null) }));
    if (this.alive && this.shown && this.controller === controller && result && [0, 1].includes(result.tapIndex)) {
      controller.chooseProposal(key, result.tapIndex === 1, context);
    }
  },
  input(event) { this.controller.input(event.currentTarget.dataset.key, event.detail.value); },
  finishEdit() { this.controller.set({ editingKey: '' }); wx.hideKeyboard(); },
  login() { goToLogin(); },
  openHandoff() { wx.navigateTo({ url: '/packages/assistant/handoff/handoff?conversationId=' + encodeURIComponent(this.options.conversationId) }); },
  retry() { return this.data.pending ? this.controller.act(this.data.pending) : this.controller.show(this.options.conversationId); },
  async confirm() {
    wx.hideKeyboard();
    if (this.data.confirmed) return this.leave();
    const proposal = this.data.proposal;
    const controller = this.controller, context = proposal ? controller.proposalContext() : '';
    let restoreConsent = false;
    const restorations = proposal ? controller.selectedRestorations() : [];
    if (proposal && restorations.length && !this.data.pending) {
      const changes = restorations.map(d => `${d.before || '尚未保存'} → ${d.after || '删除此项'}`).join('\n');
      const result = await new Promise(resolve => wx.showModal({ title: '确认恢复历史值？',
        content: changes, confirmText: '确认恢复', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!result.confirm || !this.alive || !this.shown || controller !== this.controller || context !== controller.proposalContext()) return;
      restoreConsent = true;
    }
    if (await this.controller.act('confirm', restoreConsent)) {
      if (!this.alive) return;
      wx.showToast({ title: proposal ? '需求草稿已保存' : '需求已确认保存', icon: 'success' }); this.leave();
    }
  },
  regenerate() {
    if (this.data.busy || this.data.pending || !this.data.writable) return;
    wx.showModal({ title: '根据最新对话重新整理？', content: '会生成新的草稿，请重新核对并确认；已确认的版本仍会保留。',
      success: result => {
        if (result.confirm && this.alive) { this.controller.draftSeed = null; this.controller.act('draft'); }
      },
    });
  },
  leave() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/packages/assistant/chat/chat?conversationId=' + encodeURIComponent(this.options.conversationId || '') }) });
  },
  back() {
    if (this.data.busy || this.data.pending) { wx.showToast({ title: '请先确认本次操作结果', icon: 'none' }); return; }
    if (!this.data.dirty) return this.leave();
    wx.showModal({ title: '离开需求摘要？', content: '本次修改尚未确认保存。', confirmText: '离开',
      success: result => { if (result.confirm && this.alive) this.leave(); },
    });
  },
});
