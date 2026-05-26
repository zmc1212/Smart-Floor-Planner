const app = getApp();

const CORE_TOOLS = [
  { key: 'straight', label: '直线', helper: '正交吸附', enabled: true },
  { key: 'diagonal', label: '斜线', helper: '自由角度', enabled: true },
  { key: 'thickness', label: '墙厚', helper: '200 mm', enabled: true },
  { key: 'input', label: '输入', helper: '手输 mm', enabled: true },
  { key: 'reset', label: '重置', helper: '光标', enabled: true }
];

const RESERVED_TOOLS = [
  { key: 'settings', label: '设置' },
  { key: 'reference', label: '参照' },
  { key: 'lock', label: '锁层' },
  { key: 'area', label: '面积' },
  { key: 'cad', label: 'CAD' },
  { key: 'more', label: '更多' }
];

Page({
  data: {
    statusBarHeight: 0,
    capsulePadding: 0,
    leadId: '',
    title: '新版测绘体验',
    activeView: '2D',
    activeTool: 'straight',
    measurementSide: 'right',
    thicknessMm: 200,
    prototypeNotice: '体验版不会同步正式户型数据',
    coreTools: CORE_TOOLS,
    reservedTools: RESERVED_TOOLS,
    walls: [
      { id: 'wall-1', label: '2600', className: 'wall-a' },
      { id: 'wall-2', label: '90°', className: 'wall-b' }
    ],
    historySummary: {
      undo: 0,
      redo: 0
    }
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const context = app.globalData.surveyingPrototypeContext || {};
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 0,
      capsulePadding: Math.max(0, sysInfo.windowWidth - menuButtonInfo.left),
      leadId: options.leadId || context.leadId || '',
      title: context.leadName ? `${context.leadName} · 新版测绘` : '新版测绘体验'
    });
  },

  onUnload() {
    app.globalData.surveyingPrototypeContext = null;
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/index/index' });
      }
    });
  },

  onViewTap(e) {
    const view = e.currentTarget.dataset.view;
    if (view === '2D') {
      this.setData({ activeView: view });
      return;
    }

    this.showPlannedToast();
  },

  onToolTap(e) {
    const tool = e.currentTarget.dataset.tool;
    if (tool === 'straight' || tool === 'diagonal') {
      this.setData({ activeTool: tool });
      return;
    }

    if (tool === 'thickness') {
      wx.showToast({ title: '墙厚输入将在 Phase 2 开放', icon: 'none' });
      return;
    }

    if (tool === 'input') {
      wx.showToast({ title: '毫米输入将在 Phase 2 开放', icon: 'none' });
      return;
    }

    if (tool === 'reset') {
      wx.showToast({ title: '光标已回到画布中心', icon: 'none' });
      return;
    }
  },

  onToggleSide() {
    this.setData({
      measurementSide: this.data.measurementSide === 'right' ? 'left' : 'right'
    });
    wx.showToast({ title: '墙侧切换将在 Phase 2 落几何', icon: 'none' });
  },

  onDisabledTap() {
    this.showPlannedToast();
  },

  onBottomAction(e) {
    const action = e.currentTarget.dataset.action;
    const labels = {
      bluetooth: '蓝牙测距将在 Phase 3 开放',
      manual: '手动输入将在 Phase 2 开放',
      cursor: '光标已回到中心',
      add: '构件和素材后续开放'
    };

    wx.showToast({ title: labels[action] || '功能规划中', icon: 'none' });
  },

  showPlannedToast() {
    wx.showToast({ title: '该功能暂未开放', icon: 'none' });
  }
});
