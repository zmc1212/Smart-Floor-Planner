const api = require('../../../utils/api.js');
const { displayName, familyErrorText } = require('../lib/family-view');
const { loadSiteFont } = require('../lib/site-font');
const { familyLiveMethods, normalizeFamilyCameras } = require('./family-live');

function sessionToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
}

function navigationMetrics() {
  const info = wx.getWindowInfo?.() || wx.getSystemInfoSync?.() || {};
  let capsule;
  try { capsule = wx.getMenuButtonBoundingClientRect?.(); } catch (_) { /* Use the safe fallback. */ }
  const width = info.windowWidth || 390;
  const status = info.statusBarHeight || 24;
  const center = capsule?.height && capsule.top >= status ? capsule.top + capsule.height / 2 : status + 22;
  const rightEdge = capsule?.left || width - 94;
  return { navTop: Math.round(center - 22), navRight: width - rightEdge + 8 };
}

function normalizeItem(item) {
  return {
    id: String((item && item.id) || ''),
    name: displayName(item && item.name, '未命名工地'),
    leadId: String((item && item.leadId) || ''),
    role: item && item.role === 'owner' ? 'owner' : 'family',
  };
}

Page({
  data: {
    navTop: 24,
    navRight: 102,
    loading: true,
    error: '',
    needLogin: false,
    items: [],
    projectId: '',
    projectName: '',
    role: '',
    progress: null,
    progressError: '',
    cameras: [],
    cameraIndex: 0,
    cameraError: '',
    liveSrc: '',
    livePhase: 'idle',
    liveMessage: '',
    liveEpoch: 0,
    liveSettings: false,
  },

  ...familyLiveMethods(api, sessionToken),

  onLoad(query) {
    void loadSiteFont();
    const scene = String((query && query.scene) || '');
    let invite = String((query && query.invite) || '');
    // A scanned Mini Program code only carries the 32-character scene.
    if (!invite && scene) {
      try { invite = decodeURIComponent(scene); } catch (_) { invite = scene; }
    }
    this._invite = invite;
    this._leadId = String((query && query.leadId) || '');
    this._projectId = String((query && query.projectId) || '');
    this._accepted = false;
    this._started = false;
    this._token = '';
    this.setData(navigationMetrics());
  },

  onShow() {
    this._visible = true;
    const token = sessionToken();
    if (!this._started || token !== this._token) {
      this._started = true;
      this._token = token;
      this.load();
      return;
    }
    // Returning from the viewer rechecks the current family grant.
    if (this.data.projectId && !this.data.loading && !this.data.error) {
      this.refreshProject();
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onHide() {
    this._visible = false;
    this.clearFamilyLive();
    this.setData({ liveSettings: false });
  },

  onUnload() {
    this._visible = false;
    this._generation = (this._generation || 0) + 1;
    this.clearFamilyLive();
  },

  async load() {
    this.clearFamilyLive();
    const token = sessionToken();
    this._token = token;
    const g = this._generation = (this._generation || 0) + 1;
    if (!token) {
      this.setData({ loading: false, error: '请先登录后再打开。', needLogin: true });
      return;
    }
    this.setData({ loading: true, error: '', needLogin: false });
    try {
      if (this._invite && !this._accepted) {
        const accepted = await api.request(
          '/miniprogram/construction/family-invites/' + encodeURIComponent(this._invite) + '/accept',
          'POST',
          {},
        );
        if (g !== this._generation) return;
        this._accepted = true;
        this._projectId = String((accepted.data && accepted.data.projectId) || this._projectId || '');
        this._invite = '';
      }
      const query = [];
      if (this._projectId) query.push('projectId=' + encodeURIComponent(this._projectId));
      else if (this._leadId) query.push('leadId=' + encodeURIComponent(this._leadId));
      const list = await api.request(
        '/miniprogram/construction/customer-projects' + (query.length ? '?' + query.join('&') : ''),
        'GET',
      );
      if (g !== this._generation) return;
      const items = (Array.isArray(list.data) ? list.data : [])
        .map(normalizeItem)
        .filter(item => /^[1-9]\d*$/.test(item.id));
      if (!items.length) {
        this.setData({ items: [], projectId: '', loading: false, error: '暂无可查看的云工地。' });
        return;
      }
      if (items.length === 1 || this._projectId) {
        await this.openProject(items[0], g);
        return;
      }
      this.setData({ items, projectId: '', loading: false, error: '' });
    } catch (error) {
      if (g === this._generation) this.setData({ loading: false, error: familyErrorText(error), needLogin: error && error.statusCode === 401 });
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/packages/business/login/login' });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  async openProject(item, generation) {
    const g = generation || this._generation;
    this._projectId = item.id;
    if (item.role === 'owner') {
      this.setData({ loading: true, error: '' });
      wx.reLaunch({
        url: '/pages/index/index?customerTab=service&familyProject=' + encodeURIComponent(item.id),
        fail: () => {
          if (g === this._generation) this.setData({ loading: false, error: '暂时无法打开我家工地，请重试。' });
        },
      });
      return;
    }
    const isCurrentProject = this.data.projectId === item.id;
    if (!isCurrentProject) this.clearFamilyLive();
    this.setData({
      projectId: item.id,
      projectName: item.name,
      role: item.role,
      loading: true,
      error: '',
      progress: null,
      progressError: '',
      cameras: isCurrentProject ? this.data.cameras : [],
      cameraIndex: isCurrentProject ? this.data.cameraIndex : 0,
      cameraError: '',
      liveSettings: false,
    });
    await this.refreshProject();
  },

  async refreshProject(autoplay = true) {
    const g = this._generation;
    const projectId = this.data.projectId || this._projectId;
    if (!projectId) return;
    const request = this._projectRequest = (this._projectRequest || 0) + 1;
    const [progress, cameras] = await Promise.all([
      api.request('/miniprogram/construction/projects/' + projectId + '/progress', 'GET')
        .then(result => ({ data: result.data }), error => ({ error })),
      api.request('/miniprogram/construction/video/projects/' + projectId + '/cameras', 'GET')
        .then(result => ({ data: result.data }), error => ({ error })),
    ]);
    if (g !== this._generation || request !== this._projectRequest) return;
    const currentProgress = progress.data?.progress;
    const selected = this.data.cameras[this.data.cameraIndex]?.bindingId;
    const items = normalizeFamilyCameras(cameras.data?.items);
    const selectedIndex = items.findIndex(camera => camera.bindingId === selected);
    if (selected && selectedIndex === -1) this.clearFamilyLive();
    this.setData({
      progress: currentProgress || null,
      progressError: progress.error ? familyErrorText(progress.error, '施工进度暂时无法查看。') : '',
      cameras: items,
      cameraIndex: Math.max(0, selectedIndex),
      cameraError: cameras.error ? familyErrorText(cameras.error, '直播入口暂时无法加载。') : '',
      loading: false,
    });
    if (autoplay && this.data.livePhase === 'idle') void this.startFamilyLive();
  },

  selectProject(event) {
    const id = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
    const item = this.data.items.find(project => project.id === id);
    if (item) this.openProject(item);
  },

  openCamera() {
    const projectId = this.data.projectId;
    if (!this.data.cameras.length || !/^[1-9]\d*$/.test(projectId)) return;
    this.clearFamilyLive();
    wx.navigateTo({
      url: '/packages/construction/camera/camera?projectId=' + encodeURIComponent(projectId),
      fail: () => wx.showToast({ title: '暂时无法打开兼容播放器', icon: 'none' }),
    });
  },
});
