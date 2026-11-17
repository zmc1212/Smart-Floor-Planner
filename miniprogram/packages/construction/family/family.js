const api = require('../../../utils/api.js');

function sessionToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token');
}

function operationKey() {
  return 'family-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function errorText(error) {
  const code = error && (error.error || error.code);
  if (error && error.statusCode === 401) return '请先登录后再打开。';
  if (code === 'family_invite_used') return '这份邀请已经被使用，请让家人重新分享。';
  if (code === 'construction_invite_invalid' || code === 'construction_invite_expired' || code === 'construction_not_found')
    return '邀请已失效，请让家人重新分享。';
  if (code === 'construction_forbidden' || code === 'camera_forbidden') return '当前身份不能查看这个工地。';
  if (code === 'version_conflict') return '授权状态已变化，请刷新后重试。';
  if (code === 'camera_project_unavailable' || code === 'camera_unavailable') return '工地视频暂时还没有开通。';
  return '云工地暂时无法读取，请稍后重试。';
}

function normalizeItem(item) {
  return {
    id: String((item && item.id) || ''),
    name: String((item && item.name) || '未命名工地'),
    leadId: String((item && item.leadId) || ''),
    role: item && item.role === 'owner' ? 'owner' : 'family',
  };
}

Page({
  data: {
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
    cameraError: '',
    inviteToken: '',
    inviteExpiresAt: '',
    inviteError: '',
    viewers: [],
    viewerLoading: false,
    viewerError: '',
    busy: false,
  },

  onLoad(query) {
    this._invite = String((query && query.invite) || '');
    this._leadId = String((query && query.leadId) || '');
    this._projectId = String((query && query.projectId) || '');
    this._accepted = false;
    this._started = false;
    this._token = '';
  },

  onShow() {
    const token = sessionToken();
    if (!this._started || token !== this._token) {
      this._started = true;
      this._token = token;
      this.load();
      return;
    }
    // Returning from the camera page only refreshes facts. The invite token is
    // kept so a card already shared from this page stays usable.
    if (this.data.projectId) this.refreshProject();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    const token = sessionToken();
    this._token = token;
    if (!token) {
      this.setData({ loading: false, error: '请先登录后再打开。', needLogin: true });
      return;
    }
    const g = this._generation = (this._generation || 0) + 1;
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
      if (g === this._generation) this.setData({ loading: false, error: errorText(error), needLogin: error && error.statusCode === 401 });
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/packages/business/login/login' });
  },

  async openProject(item, generation) {
    const g = generation || this._generation;
    this._projectId = item.id;
    this.setData({
      projectId: item.id,
      projectName: item.name,
      role: item.role,
      loading: true,
      error: '',
      progress: null,
      progressError: '',
      cameras: [],
      cameraError: '',
      inviteToken: '',
      inviteExpiresAt: '',
      inviteError: '',
      viewers: [],
      viewerError: '',
    });
    await this.refreshProject(g);
    if (item.role === 'owner') {
      await this.loadViewers(g);
      if (!this.data.inviteToken) await this.createInvite(g);
    }
  },

  async refreshProject(generation) {
    const g = generation || this._generation;
    const projectId = this.data.projectId || this._projectId;
    if (!projectId) return;
    const [progress, cameras] = await Promise.all([
      api.request('/miniprogram/construction/projects/' + projectId + '/progress', 'GET')
        .then(result => ({ data: result.data }), error => ({ error })),
      api.request('/miniprogram/construction/video/projects/' + projectId + '/cameras', 'GET')
        .then(result => ({ data: result.data }), error => ({ error })),
    ]);
    if (g !== this._generation) return;
    const progressData = progress && progress.data;
    this.setData({
      progress: progressData && progressData.progress ? progressData.progress : null,
      progressError: progress.error ? errorText(progress.error) : '',
      cameras: cameras.data && Array.isArray(cameras.data.items) ? cameras.data.items : [],
      cameraError: cameras.error ? errorText(cameras.error) : '',
      loading: false,
    });
  },

  async loadViewers(generation) {
    if (this.data.role !== 'owner' || !this.data.projectId) return;
    const g = generation || this._generation;
    this.setData({ viewerLoading: true, viewerError: '' });
    try {
      const result = await api.request(
        '/miniprogram/construction/projects/' + this.data.projectId + '/family-viewers',
        'GET',
      );
      if (g !== this._generation) return;
      this.setData({ viewers: Array.isArray(result.data) ? result.data : [], viewerLoading: false });
    } catch (error) {
      if (g === this._generation) this.setData({ viewers: [], viewerLoading: false, viewerError: errorText(error) });
    }
  },

  async createInvite(generation) {
    if (this.data.role !== 'owner' || !this.data.projectId) return;
    const g = generation || this._generation;
    this.setData({ inviteError: '' });
    try {
      const result = await api.request(
        '/miniprogram/construction/projects/' + this.data.projectId + '/family-invite',
        'POST',
        {},
      );
      if (g !== this._generation) return;
      this.setData({
        inviteToken: String((result.data && result.data.token) || ''),
        inviteExpiresAt: String((result.data && result.data.expiresAt) || ''),
      });
    } catch (error) {
      if (g === this._generation) this.setData({ inviteError: errorText(error) });
    }
  },

  refreshInvite() {
    return this.createInvite();
  },

  selectProject(event) {
    const id = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
    const item = this.data.items.find(project => project.id === id);
    if (item) this.openProject(item);
  },

  openCamera(event) {
    const projectId = String((event.currentTarget.dataset && event.currentTarget.dataset.project) || this.data.projectId);
    if (!/^[1-9]\d*$/.test(projectId)) return;
    wx.navigateTo({ url: '/packages/construction/camera/camera?projectId=' + encodeURIComponent(projectId) });
  },

  async revokeViewer(event) {
    const viewerId = String((event.currentTarget.dataset && event.currentTarget.dataset.viewer) || '');
    const version = Number(event.currentTarget.dataset && event.currentTarget.dataset.version);
    if (!/^[1-9]\d*$/.test(viewerId) || !Number.isSafeInteger(version) || this.data.busy) return;
    this.setData({ busy: true, viewerError: '' });
    try {
      await api.request(
        '/miniprogram/construction/projects/' + this.data.projectId + '/family-viewers/' + viewerId,
        'POST',
        { expectedVersion: version, allowed: false },
        { headers: { 'Idempotency-Key': operationKey() } },
      );
      wx.showToast({ title: '已撤销', icon: 'success' });
      await this.loadViewers();
    } catch (error) {
      this.setData({ viewerError: errorText(error) });
    } finally {
      this.setData({ busy: false });
    }
  },

  onShareAppMessage() {
    const projectId = this.data.projectId || this._projectId;
    const params = [];
    if (projectId) params.push('projectId=' + encodeURIComponent(projectId));
    if (this.data.inviteToken) params.push('invite=' + encodeURIComponent(this.data.inviteToken));
    return {
      title: '家人一起看工地进度',
      path: '/packages/construction/family/family' + (params.length ? '?' + params.join('&') : ''),
    };
  },
});
