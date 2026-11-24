const api = require('../../../utils/api');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { loadSiteFont } = require('../lib/site-font');
const { SiteCapture } = require('../chat/site-capture');
const { uploadSiteMedia } = require('../chat/site-client');

const route = '/packages/construction/report/report';
const maxPhotos = 9;

function metrics() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let capsule;
  try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* Native safe fallback. */ }
  return {
    navTop: Math.max(info.statusBarHeight || 24, capsule?.top || 46),
    navHeight: capsule?.height || 32,
    navRight: info.windowWidth - (capsule?.left || info.windowWidth - 94) + 10,
  };
}

function identity() {
  const app = getApp(), global = app.globalData || {};
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return {
    token: global.token || wx.getStorageSync('token'),
    key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    bootstrap: global.bootstrap || global.userInfo,
  };
}

function decorateStages(stages, selected) {
  const chosen = new Set(selected || []);
  return (stages || []).map(stage => ({ ...stage, selected: chosen.has(stage.key) }));
}
function checkpointChoices(stages, selected, checkpoint) {
  return stages.filter(stage => selected.includes(stage.key)).flatMap(stage => (stage.inspectionCheckpoints || []).map(item => ({
    ...item, stageKey: stage.key, choiceId: stage.key + ':' + item.key,
    selected: checkpoint?.stageKey === stage.key && checkpoint.key === item.key,
  })));
}

Page({
  data: {
    ...metrics(),
    mode: 'photo',
    loading: true,
    error: '',
    project: null,
    stages: [],
    stageChips: [],
    selectedStages: [],
    checkpoints: [],
    checkpointChanged: false,
    photos: [],
    voice: null,
    text: '',
    textLength: 0,
    queue: [],
    saving: false,
    sending: false,
    submitting: false,
    captureError: '',
    recording: false,
    recordSeconds: 0,
    voicePlaying: false,
    success: false,
    maxPhotos,
  },

  onLoad(options) {
    this.projectId = /^[1-9]\d*$/.test(String(options.projectId || '')) ? String(options.projectId) : '';
    this.data.mode = options.mode === 'voice' ? 'voice' : options.mode === 'photo' ? 'photo' : 'manual';
    this._visible = true;
    this._voicePaths = new Set();
    loadSiteFont();
    if (!this.projectId) {
      this.setData({ loading: false, error: '工地信息不完整，请返回后重试。' });
      return;
    }
    void this.load();
  },

  onShow() {
    this._visible = true;
    if (this.capture && this.capture.value?.queue?.length) void this.capture.flush();
  },

  onHide() {
    this._visible = false;
    this.stopRecording();
    this.stopVoice();
  },

  onUnload() {
    this._visible = false;
    this.stopRecording();
    this.stopVoice();
    if (this.capture) this.capture.hide();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const app = getApp();
      if (app.globalData?.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
      if (!this._visible) return;
      const current = identity();
      if (!current.token || !canAccessRoute(route, current.bootstrap)) {
        this.setData({ loading: false, error: '当前身份没有工地上报权限，请返回后重新登录。' });
        return;
      }
      const result = await api.request('/miniprogram/construction/workbench?projectId=' + this.projectId, 'GET', {}, { suppressUnauthorized: true });
      const data = result.data || {};
      if (!this._visible) return;
      if (data.view !== 'worker' || !data.project) {
        this.setData({ loading: false, error: '这个工地当前不能上报，请返回工地列表重新选择。' });
        return;
      }
      if (!data.canCapture) {
        this.setData({ loading: false, error: '当前工地已暂停上报，请联系施工经理。', project: data.project });
        return;
      }
      const stages = Array.isArray(data.stages) ? data.stages : [];
      if (!stages.length) {
        this.setData({ loading: false, error: '企业还没有配置施工阶段，请联系管理员后再上报。', project: data.project });
        return;
      }
      this.setData({ loading: false, project: data.project, stages, stageChips: decorateStages(stages, []) });
      this.createCapture(current, data);
      if (this.data.mode === 'photo' && !this.data.photos.length) {
        setTimeout(() => { if (this._visible && !this.data.photos.length) this.choosePhotos(true); }, 420);
      } else if (this.data.mode === 'voice' && !this.data.voice) {
        setTimeout(() => { if (this._visible && !this.data.voice) this.toggleRecord(); }, 420);
      }
    } catch (error) {
      if (this._visible) this.setData({ loading: false, error: '暂时无法读取工地，请返回后重试。' });
    }
  },

  createCapture(current, data) {
    const site = {
      base: '/miniprogram/construction/projects/' + this.projectId + '/chat',
      projectId: this.projectId,
      epoch: 1,
      session: { key: current.key || String(current.token).slice(-16) },
      storage: {
        get: key => wx.getStorageSync(key),
        set: (key, value) => wx.setStorageSync(key, value),
        remove: key => wx.removeStorageSync(key),
      },
      request: api.request,
      uploadFile: uploadSiteMedia,
      state: { items: [], rooms: [], quickWorks: [], write: true, fatal: false },
      current: () => this._visible,
      load: async () => {
        const result = await api.request('/miniprogram/construction/workbench?projectId=' + this.projectId, 'GET', {}, { suppressUnauthorized: true });
      const items = result.data?.reports?.items || [];
        site.state.items = items.map(item => ({ message: { client_message_id: item.clientMessageId } }));
      },
    };
    this.site = site;
    this.capture = new SiteCapture({ site, requireStages: true, emit: patch => this.applyCapture(patch) });
    this.capture.show();
    const selected = Array.isArray(this.capture.value?.draft?.stageKeys) ? this.capture.value.draft.stageKeys : [];
    this.setData({ selectedStages: selected, stageChips: decorateStages(data.stages, selected) });
    if (this.capture.value?.queue?.length) void this.capture.flush();
  },

  applyCapture(patch) {
    if (!this._visible) return;
    const next = {};
    if ('captureText' in patch) {
      next.text = patch.captureText || '';
      next.textLength = (patch.captureText || '').length;
    }
    if ('capturePhotos' in patch) next.photos = patch.capturePhotos || [];
    if ('captureVoice' in patch) next.voice = patch.captureVoice || null;
    if ('captureStages' in patch) {
      next.selectedStages = patch.captureStages;
      next.stageChips = decorateStages(this.data.stages, next.selectedStages);
      next.checkpoints = checkpointChoices(this.data.stages, next.selectedStages, patch.captureCheckpoint);
    }
    if ('captureQueue' in patch) {
      next.queue = patch.captureQueue || [];
      next.checkpointChanged = next.queue.some(item => item.checkpointChanged);
    }
    if ('captureSaving' in patch) next.saving = Boolean(patch.captureSaving);
    if ('captureSending' in patch) next.sending = Boolean(patch.captureSending);
    if ('captureError' in patch) next.captureError = patch.captureError || '';
    if (patch.captureSubmitted) this._sawQueue = true;
    if (next.queue?.length) this._sawQueue = true;
    this.setData(next);
    if (!this._submitting) return;
    if (next.captureError) {
      this._submitting = false;
      this.setData({ submitting: false });
      return;
    }
    const sending = 'captureSending' in patch ? Boolean(patch.captureSending) : this.data.sending;
    const queue = 'captureQueue' in patch ? (patch.captureQueue || []) : this.data.queue;
    if (this._sawQueue && !sending && !queue.length) this.finishSuccess();
  },

  finishSuccess() {
    if (this._done) return;
    this._done = true;
    this._submitting = false;
    this.setData({ submitting: false, success: true, captureError: '' });
    wx.showToast({ title: '已提交，等待审核', icon: 'success' });
    setTimeout(() => {
      if (!this._visible) return;
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
    }, 900);
  },

  toggleStage(event) {
    if (this.data.submitting || this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const current = this.data.selectedStages || [];
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    if (this.capture) this.capture.stages(next);
    this.setData({ selectedStages: next, stageChips: decorateStages(this.data.stages, next) });
  },
  toggleCheckpoint(event) {
    if (this.data.submitting || this.data.saving || !this.capture) return;
    const item = this.data.checkpoints.find(candidate => candidate.choiceId === event.currentTarget.dataset.id);
    if (item) this.capture.checkpoint(item.selected ? null : { stageKey: item.stageKey, key: item.key });
  },
  async replaceCheckpoint() {
    if (!this.capture?.restoreCheckpointDraft()) return;
    this._submitting = false;
    this._sawQueue = false;
    this.setData({ submitting: false });
    try {
      const result = await api.request('/miniprogram/construction/workbench?projectId=' + this.projectId, 'GET', {}, { suppressUnauthorized: true });
      if (this._visible && result.data?.stages) {
        this.setData({ stages: result.data.stages }, () => this.capture.render());
      }
      if (this._visible) this.setData({ captureError: '原材料已恢复，请按当前工序提交。' });
    } catch {
      if (this._visible) this.setData({ captureError: '原材料已恢复，请重进上报页读取最新工序。' });
    }
  },

  choosePhotos(cameraOnly = false) {
    if (this.data.saving || this.data.submitting || !this.capture) return;
    const remaining = maxPhotos - (this.data.photos || []).length;
    if (remaining <= 0) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: cameraOnly === true ? ['camera'] : ['album', 'camera'],
      sizeType: ['compressed'],
      success: async result => {
        for (const file of result.tempFiles || []) {
          if (!this._visible || !file.tempFilePath) return;
          await this.capture.addFile(file.tempFilePath, 'photo');
        }
      },
    });
  },

  addPhotos() { this.choosePhotos(false); },

  previewPhoto(event) {
    const path = event.currentTarget.dataset.path;
    if (!path) return;
    wx.previewImage({ current: path, urls: (this.data.photos || []).map(item => item.path) });
  },

  removePhoto(event) {
    const id = event.currentTarget.dataset.id;
    if (id && this.capture) void this.capture.removeFile(id);
  },

  onTextInput(event) {
    const value = event.detail.value || '';
    if (this.capture) this.capture.input(value);
    this.setData({ text: value, textLength: value.length });
  },

  toggleRecord() {
    if (this.data.submitting || this.data.saving) return;
    if (this.data.recording) {
      this.stopRecording();
      return;
    }
    if (this.data.voice) return;
    const recorder = wx.getRecorderManager();
    this.recorder = recorder;
    if (recorder.offStart) recorder.offStart();
    if (recorder.offStop) recorder.offStop();
    if (recorder.offError) recorder.offError();
    recorder.onStart(() => {
      this._recordStartedAt = Date.now();
      this.setData({ recording: true, recordSeconds: 0, captureError: '' });
      this.clearRecordTimer();
      this._recordTimer = setInterval(() => {
        this.setData({ recordSeconds: Math.floor((Date.now() - this._recordStartedAt) / 1000) });
      }, 500);
    });
    recorder.onStop(result => {
      this.clearRecordTimer();
      this.setData({ recording: false });
      const path = result?.tempFilePath;
      if (path && this._visible && this.capture) void this.capture.addFile(path, 'voice', result.duration || 0);
    });
    recorder.onError(() => {
      this.clearRecordTimer();
      this.setData({ recording: false, captureError: '录音未完成，请检查麦克风权限后重试。' });
    });
    recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'wav' });
  },

  stopRecording() {
    this.clearRecordTimer();
    if (this.data.recording && this.recorder) {
      try { this.recorder.stop(); } catch { /* Recorder may already be closed. */ }
    }
    this.setData({ recording: false });
  },

  clearRecordTimer() {
    if (this._recordTimer) clearInterval(this._recordTimer);
    this._recordTimer = null;
  },

  playVoice() {
    if (this.audio) {
      this.stopVoice();
      return;
    }
    const path = this.data.voice?.path;
    if (!path) return;
    const audio = wx.createInnerAudioContext();
    this.audio = audio;
    audio.src = path;
    audio.onEnded(() => this.stopVoice());
    audio.onError(() => {
      this.stopVoice();
      this.setData({ captureError: '这段录音暂时无法回听，请重新录制。' });
    });
    audio.play();
    this.setData({ voicePlaying: true });
  },

  stopVoice() {
    if (this.audio) {
      try { this.audio.stop(); } catch { /* Audio context may already be destroyed. */ }
      try { this.audio.destroy(); } catch { /* Ignore repeated destruction. */ }
      this.audio = null;
    }
    if (this.data.voicePlaying) this.setData({ voicePlaying: false });
  },

  removeVoice() {
    this.stopVoice();
    const id = this.data.voice?.id;
    if (id && this.capture) void this.capture.removeFile(id);
  },

  submit() {
    if (this.data.loading || this.data.submitting || !this.capture) return;
    if (this.data.recording) {
      wx.showToast({ title: '请先结束录音', icon: 'none' });
      return;
    }
    if (!this.data.selectedStages.length) {
      wx.showToast({ title: '请选择施工阶段', icon: 'none' });
      return;
    }
    if (!this.data.text.trim() && !this.data.photos.length && !this.data.voice) {
      wx.showToast({ title: '请添加照片、语音或文字', icon: 'none' });
      return;
    }
    this._sawQueue = false;
    this._submitting = true;
    this.setData({ submitting: true, captureError: '' });
    if (!this.capture.submit(false)) {
      this._submitting = false;
      this.setData({ submitting: false });
    }
  },

  retryUpload() {
    if (!this.capture || this.data.sending) return;
    this.setData({ captureError: '' });
    void this.capture.flush();
  },

  back() {
    if (this.data.submitting || this.data.sending || (this.data.queue || []).length) {
      wx.showModal({
        title: '还在提交',
        content: '材料正在上传，离开后可在下次进入时继续提交。确定离开？',
        confirmText: '离开',
        success: result => { if (result.confirm) wx.navigateBack(); },
      });
      return;
    }
    if (this.data.text.trim() || this.data.photos.length || this.data.voice) {
      wx.showModal({
        title: '内容已保存在本机',
        content: '现在离开不会丢失，下次进入可以继续上报。确定离开？',
        confirmText: '离开',
        success: result => { if (result.confirm) wx.navigateBack(); },
      });
      return;
    }
    wx.navigateBack();
  },

  noop() {},
});
