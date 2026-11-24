const api = require('../../../utils/api');
const { displayName, familyErrorText } = require('../lib/family-view');

const projectPath = '/miniprogram/construction/projects/';
const scopedRequest = { suppressUnauthorized: true };

function sessionToken() {
  return getApp().globalData.token || wx.getStorageSync('token') || '';
}

function buildEnvVersion() {
  try {
    const version = wx.getAccountInfoSync().miniProgram.envVersion;
    if (version === 'develop' || version === 'trial') return version;
  } catch (_) {
    // The released build is the default when the host omits the version.
  }
  return 'release';
}

Component({
  properties: { projectId: String },
  data: {
    open: false,
    inviteToken: '',
    inviteLoading: false,
    inviteError: '',
    inviteCodeOpen: false,
    inviteCodePath: '',
    inviteCodeLoading: false,
    inviteCodeError: '',
    viewers: [],
    viewerLoading: true,
    viewerError: '',
    busy: false,
  },
  lifetimes: {
    attached() {
      this._scope = { projectId: this.data.projectId, token: sessionToken() };
      this._animation = setTimeout(() => this.setData({ open: true }), 25);
      void this.loadViewers();
      void this.createInvite();
    },
    detached() {
      clearTimeout(this._animation);
      this._scope = null;
    },
  },
  methods: {
    current(scope) {
      return Boolean(scope && this._scope === scope && scope.token &&
        this.data.projectId === scope.projectId && sessionToken() === scope.token);
    },

    close() {
      if (!this._scope) return;
      this._scope = null;
      clearTimeout(this._animation);
      this.setData({ open: false });
      this._animation = setTimeout(() => this.triggerEvent('dismiss'), 260);
    },

    stop() {},

    shareInvite() {
      const scope = this._scope, token = this.data.inviteToken;
      if (!this.current(scope) || !token || this.data.inviteLoading) return null;
      return {
        title: '家人一起看工地进度',
        path: '/packages/construction/family/family?projectId=' + encodeURIComponent(scope.projectId) +
          '&invite=' + encodeURIComponent(token),
      };
    },

    async loadViewers() {
      const scope = this._scope;
      if (!this.current(scope) || !/^[1-9]\d*$/.test(scope.projectId)) return;
      const request = this._viewerRequest = (this._viewerRequest || 0) + 1;
      const current = () => this.current(scope) && this._viewerRequest === request;
      this.setData({ viewerLoading: true, viewerError: '' });
      try {
        const { data } = await api.request(projectPath + scope.projectId + '/family-viewers', 'GET', {}, scopedRequest);
        if (!current()) return;
        const viewers = Array.isArray(data) ? data.map(item => ({
          viewerId: item.viewerId,
          version: item.version,
          nickname: displayName(item.nickname, '家人'),
        })) : [];
        this.setData({ viewers, viewerLoading: false });
      } catch (error) {
        if (current()) this.setData({
          viewers: [],
          viewerLoading: false,
          viewerError: familyErrorText(error, '家人名单暂时无法加载。'),
        });
      }
    },

    async createInvite() {
      const scope = this._scope;
      if (!this.current(scope) || !/^[1-9]\d*$/.test(scope.projectId) || this.data.inviteLoading || this.data.inviteCodeLoading) return;
      this.setData({ inviteLoading: true, inviteError: '' });
      const failure = '邀请暂时无法生成，请重试。';
      try {
        const { data } = await api.request(projectPath + scope.projectId + '/family-invite', 'POST', {}, scopedRequest);
        if (!this.current(scope)) return;
        const token = String(data?.token || '');
        if (!token) {
          this.setData({ inviteError: failure });
          return;
        }
        this.setData({ inviteToken: token, inviteCodePath: '', inviteCodeError: '' });
        if (this.data.inviteCodeOpen) void this.loadInviteCode();
      } catch (error) {
        if (this.current(scope)) this.setData({ inviteError: familyErrorText(error, failure) });
      } finally {
        if (this.current(scope)) this.setData({ inviteLoading: false });
      }
    },

    toggleInviteCode() {
      if (!this.current(this._scope) || !this.data.inviteToken || this.data.inviteLoading) return;
      const inviteCodeOpen = !this.data.inviteCodeOpen;
      this.setData({ inviteCodeOpen });
      if (inviteCodeOpen && !this.data.inviteCodePath) return this.loadInviteCode();
    },

    async loadInviteCode() {
      const scope = this._scope;
      if (!this.current(scope) || !/^[1-9]\d*$/.test(scope.projectId) ||
          !this.data.inviteCodeOpen || !this.data.inviteToken || this.data.inviteCodeLoading) return;
      this.setData({ inviteCodeLoading: true, inviteCodeError: '' });
      const failure = '邀请码暂时无法生成，请重试。';
      console.log('[familySheet] invite-code GET env=' + buildEnvVersion() + ' project=' + scope.projectId);
      try {
        const file = await api.downloadFile(projectPath + scope.projectId + '/family-invite-code?env=' + buildEnvVersion(), scopedRequest);
        if (!this.current(scope)) return;
        const inviteCodePath = String(file?.tempFilePath || '');
        this.setData({ inviteCodePath, inviteCodeError: inviteCodePath ? '' : failure });
      } catch (error) {
        console.error('[familySheet] invite-code failed: ' + JSON.stringify(error || {}));
        if (this.current(scope)) this.setData({ inviteCodePath: '', inviteCodeError: familyErrorText(error, failure) });
      } finally {
        if (this.current(scope)) this.setData({ inviteCodeLoading: false });
      }
    },

    previewInviteCode() {
      const path = this.data.inviteCodePath;
      if (this.current(this._scope) && this.data.inviteCodeOpen && path) wx.previewImage({ current: path, urls: [path] });
    },

    saveInviteCode() {
      const filePath = this.data.inviteCodePath;
      if (!this.current(this._scope) || !this.data.inviteCodeOpen || !filePath || !wx.saveImageToPhotosAlbum) return;
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: (error) => wx.showToast({
          title: String(error?.errMsg || '').includes('auth') ? '请允许保存到相册' : '保存失败，请重试',
          icon: 'none',
        }),
      });
    },

    async revokeViewer(event) {
      const scope = this._scope, dataset = event.currentTarget.dataset;
      const viewerId = String(dataset.viewer || ''), version = Number(dataset.version);
      if (!this.current(scope) || !/^[1-9]\d*$/.test(viewerId) || !Number.isSafeInteger(version) ||
          this.data.busy || this.data.viewerLoading) return;
      this.setData({ busy: true, viewerError: '' });
      try {
        await api.request(projectPath + scope.projectId + '/family-viewers/' + viewerId, 'POST',
          { expectedVersion: version, allowed: false }, {
            ...scopedRequest,
            headers: { 'Idempotency-Key': 'family-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) },
          });
        if (!this.current(scope)) return;
        wx.showToast({ title: '已移除', icon: 'success' });
        await this.loadViewers();
      } catch (error) {
        if (!this.current(scope)) return;
        if ((error.error || error.code) === 'version_conflict') {
          await this.loadViewers();
          if (!this.current(scope) || this.data.viewerError) return;
        }
        this.setData({ viewerError: familyErrorText(error, '暂时无法移除，请重试。') });
      } finally {
        if (this.current(scope)) this.setData({ busy: false });
      }
    },
  },
});
