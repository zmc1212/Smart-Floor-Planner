const api = require('../../../utils/api');
const { displayName, familyErrorText } = require('../lib/family-view');

const projectPath = '/miniprogram/construction/projects/';
const scopedRequest = { suppressUnauthorized: true };
const inviteCover = '/packages/construction/assets/notebook/family-invite-share-cover.jpg';
const defaultInviteTitle = '邀请你看我家的装修进度';

function inviteTitle({ communityName, areaLabel }) {
  // The legacy community field can hold a synced appointment address.
  const label = displayName(String(communityName || '').normalize('NFKC'), '');
  const streetNumber = /(?:路|街|巷|道|弄|胡同)\s*[\d零〇一二三四五六七八九十百]+\s*(?:号|弄)/;
  if (streetNumber.test(label)) return defaultInviteTitle;

  const buildingOrRoom = /(?:[a-z]?\d+[a-z]?|[零〇一二三四五六七八九十百]+)\s*(?:号楼|栋|幢|单元|座|层|楼|室|房)|[a-z]\s*座/i;
  const shortName = label.split(buildingOrRoom, 1)[0]
    .replace(/(?:[\s·,，/]+\d{3,}[a-z]?|[\s·,，]+\d+[-/]\d+|\d+(?:[-/]\d+){2,})$/i, '')
    .replace(/[\s·,，/、-]+$/, '')
    .replace(/\s+/g, ' ');
  if (!shortName || /^\d+\s*号?$/.test(shortName)) return defaultInviteTitle;

  return [shortName, areaLabel].filter(Boolean).join(' ') + ' · 装修进度';
}

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
  pageLifetimes: {
    show() {
      if (!this.data.viewerLoading && !this.data.busy) void this.loadViewers();
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

    shareInvite(project) {
      const scope = this._scope;
      const { inviteToken, inviteLoading, inviteCodeOpen } = this.data;
      if (!this.current(scope) || project?.id !== scope.projectId || !inviteToken || inviteLoading || inviteCodeOpen) return null;
      // The native picker may be cancelled. Reuse neither the handed-off card nor its token.
      this.setData({ inviteToken: '' });
      void this.createInvite();
      return {
        title: inviteTitle(project),
        path: '/packages/construction/family/family?projectId=' + encodeURIComponent(scope.projectId) +
          '&invite=' + encodeURIComponent(inviteToken),
        imageUrl: inviteCover,
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
      if (!this.current(scope) || !/^[1-9]\d*$/.test(scope.projectId) || this.data.inviteToken || this.data.inviteLoading) return;
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
        this.setData({ inviteToken: token });
      } catch (error) {
        if (this.current(scope)) this.setData({ inviteError: familyErrorText(error, failure) });
      } finally {
        if (this.current(scope)) this.setData({ inviteLoading: false });
      }
    },

    openInviteCode() {
      if (!this.current(this._scope) || this.data.inviteCodeOpen) return;
      this.setData({ inviteCodeOpen: true });
      return this.loadInviteCode();
    },

    closeInviteCode() {
      if (!this.data.inviteCodeOpen) return;
      this.setData({ inviteCodeOpen: false, inviteCodePath: '', inviteCodeLoading: false, inviteCodeError: '' });
      if (!this.data.busy) void this.loadViewers();
    },

    async loadInviteCode() {
      const scope = this._scope;
      if (!this.current(scope) || !/^[1-9]\d*$/.test(scope.projectId) ||
          !this.data.inviteCodeOpen || this.data.inviteCodeLoading) return;
      const request = this._codeRequest = (this._codeRequest || 0) + 1;
      const current = () => this.current(scope) && this.data.inviteCodeOpen && this._codeRequest === request;
      this.setData({ inviteCodeLoading: true, inviteCodeError: '' });
      const failure = '邀请码暂时无法生成，请重试。';
      try {
        const file = await api.downloadFile(projectPath + scope.projectId + '/family-invite-code?env=' + buildEnvVersion(), scopedRequest);
        if (!current()) return;
        const inviteCodePath = String(file?.tempFilePath || '');
        this.setData({ inviteCodePath, inviteCodeError: inviteCodePath ? '' : failure });
      } catch (error) {
        if (current()) this.setData({ inviteCodePath: '', inviteCodeError: familyErrorText(error, failure) });
      } finally {
        if (current()) this.setData({ inviteCodeLoading: false });
      }
    },

    previewInviteCode() {
      const path = this.data.inviteCodePath;
      if (this.current(this._scope) && this.data.inviteCodeOpen && path) wx.previewImage({ current: path, urls: [path] });
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
