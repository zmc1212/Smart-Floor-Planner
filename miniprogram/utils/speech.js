const api = require('./api');
const { AssistantClient, uncertain } = require('./assistant-client');
const ACTIVE = ['queued', 'running'];
let recorderOwner = null;
const invoke = (method, input = {}) => new Promise((resolve, reject) => wx[method]({ ...input, success: resolve, fail: reject }));

/** Shared recorder/playback adapter. Original C01/S04 send controllers own all business writes. */
class SpeechController {
  constructor({ identity, emit, getDraft, setDraft, reload, request = api.request }) {
    Object.assign(this, { identity, emit, getDraft, setDraft, reload, request }); this.epoch = 0;
  }
  valid(epoch) { return this.visible && this.epoch === epoch && this.session === this.identity(); }
  setBusy(busy) { this.busy = busy; this.emit({ speechBusy: busy }); }
  async show(base) {
    this.hide(); this.loadedAsset = null; this.visible = true; this.base = base; this.session = this.identity(); this.client = new AssistantClient(this.request, base);
    return this.refresh(true);
  }
  hide() {
    this.visible = false; ++this.epoch; clearTimeout(this.timer); this.cancelled = true;
    if (this.recorder) { try { this.recorder.stop(); } catch (_) {} }
    if (this.recordingPath) { this.detachRecorder?.(); if (recorderOwner === this) recorderOwner = null;
      try { wx.getFileSystemManager().unlink({ filePath: this.recordingPath, fail() {} }); } catch (_) {} this.recordingPath = ''; }
    this.recorder = null; this.stopPlayback(); this.asset = null; this.items = []; this.available = false; this.setBusy(false); this.emit({ speechError: '', speechAvailable: false });
  }
  message(text = '语音暂未完成，可以稍后重试或改用文字。') { this.emit({ speechError: text }); wx.showToast({ title: '语音暂未完成，可重试或改用文字', icon: 'none' }); }
  async refresh(restore = false) {
    if (!this.visible) return;
    if (this.session !== this.identity()) { this.hide(); return; }
    const epoch = this.epoch;
    try {
      const data = await this.client.read(''); if (!this.valid(epoch)) return;
      this.available = data.available === true; this.items = data.items || [];
      this.emit({ speechAvailable: this.available });
      this.asset = this.items.find(a => a.own && !a.messageId) || null;
      this.setBusy(recorderOwner === this || !!this.asset && ACTIVE.includes(this.asset.status));
      this.emit({ speechError: this.asset && ['failed','cancelled','indeterminate'].includes(this.asset.status)
        ? '语音未能转成文字，原音已保留。可从麦克风重试，也可删除录音后改用文字。' : '' });
      if (this.asset?.status === 'succeeded' && this.asset.transcript && this.loadedAsset !== this.asset.id) {
        this.loadedAsset = this.asset.id;
        const draft = this.getDraft();
        if (!restore || !draft) this.setDraft(draft ? draft + '\n' + this.asset.transcript : this.asset.transcript);
        wx.showToast({ title: '已转成文字，请核对后发送', icon: 'none' });
      }
      if (this.busy) this.timer = setTimeout(() => this.refresh(), 1500);
      return true;
    } catch (error) {
      if (!this.valid(epoch)) return;
      this.setBusy(false);
      this.available = false; this.emit({ speechAvailable: false });
      if ([401, 403, 404].includes(error.statusCode)) { this.asset = null; this.items = []; this.stopPlayback(); }
      else this.message();
      return false;
    }
  }
  binding() { return this.asset?.status === 'succeeded' ? { id: this.asset.id, version: this.asset.version } : undefined; }
  async afterSend() { this.loadedAsset = null; return this.refresh(); }
  async microphone() {
    const epoch = this.epoch; if (!await this.refresh() || !this.valid(epoch)) return;
    const pending = this.client.pending.get('speech-upload:' + this.base);
    const retry = [...this.client.pending.entries()].find(([slot]) => slot.startsWith('speech-retry:' + this.base + ':'));
    if (pending) {
      const choice = await invoke('showActionSheet', { itemList: ['核对同一次录音上传', '暂时改用文字'] }).catch(() => null);
      if (!choice || !this.valid(epoch) || choice.tapIndex !== 0) return;
      return this.upload();
    }
    if (retry) {
      const choice = await invoke('showActionSheet', { itemList: ['核对同一次转写', '暂时改用文字'] }).catch(() => null);
      if (!choice || !this.valid(epoch) || choice.tapIndex !== 0) return;
      try { await this.client.mutate(retry[0], retry[1].path, retry[1].body); if (this.valid(epoch)) await this.refresh(); }
      catch (_) { if (this.valid(epoch)) this.message('转写结果待核对，可再从麦克风处理同一次操作。'); }
      return;
    }
    if (!this.available && !this.asset) { wx.showToast({ title: '语音暂不可用，可以打字或发图', icon: 'none' }); return; }
    const recent = this.asset || this.items[0];
    if (recent) return this.menu(recent);
    return this.record();
  }
  async menu(asset) {
    const epoch = this.epoch;
    const actions = ['回听原音'];
    if (asset.own && !asset.messageId && ['failed', 'cancelled'].includes(asset.status)) actions.push('重新转写');
    if (asset.own) actions.push('删除录音及转写');
    if (!this.asset && this.available) actions.push('录一段新语音');
    const choice = await invoke('showActionSheet', { itemList: actions }).catch(() => null);
    if (!choice || !this.valid(epoch)) return;
    try {
      const action = actions[choice.tapIndex];
      if (action === '回听原音') return await this.play(asset.id);
      if (action === '录一段新语音') return this.record();
      if (action === '重新转写') {
        await this.client.mutate('speech-retry:' + this.base + ':' + asset.id, '/' + asset.id + '/retry', { expectedVersion: asset.version });
      } else if (action === '删除录音及转写') {
        const result = await invoke('showModal', { title: '删除这段录音？', content: '原音及其转写来源将失效，相关回答和现场记录需要重新核对。', confirmText: '删除' });
        if (!result.confirm || !this.valid(epoch)) return;
        await this.client.mutate('speech-remove:' + this.base + ':' + asset.id, '/' + asset.id, {}, 'DELETE');
        this.stopPlayback(); this.asset = null; this.loadedAsset = null; this.setDraft(''); await this.reload();
      }
      if (this.valid(epoch)) await this.refresh();
    } catch (_) { if (this.valid(epoch)) this.message(); }
  }
  async messageMenu(messageId) {
    const epoch = this.epoch; if (!await this.refresh() || !this.valid(epoch)) return;
    const asset = this.items.find(a => a.messageId === String(messageId)); if (asset) return this.menu(asset);
  }
  async record() {
    const epoch = this.epoch;
    if (!this.available || this.asset || !this.valid(epoch)) return;
    if (recorderOwner) { wx.showToast({ title: '上一段录音正在结束，请稍后再试', icon: 'none' }); return; }
    try { await invoke('authorize', { scope: 'scope.record' }); } catch (_) { wx.showToast({ title: '未获得录音权限，可以继续打字', icon: 'none' }); return; }
    if (!this.valid(epoch)) return;
    if (recorderOwner) return;
    recorderOwner = this;
    this.cancelled = false; this.recorder = wx.getRecorderManager(); const manager = this.recorder;
    let stopped = null, decided = false, consumed = false;
    const detach = () => { manager.offStop(this.onStop); manager.offError(this.onError); if (this.recorder === manager) this.recorder = null; };
    this.detachRecorder = detach;
    const release = () => { if (recorderOwner === this) recorderOwner = null; };
    const disposeOriginal = result => { if (result?.tempFilePath) try { wx.getFileSystemManager().unlink({ filePath: result.tempFilePath, fail() {} }); } catch (_) {} if (this.recordingPath === result?.tempFilePath) this.recordingPath = ''; };
    this.onError = () => { detach(); release(); if (this.valid(epoch)) { this.setBusy(false); this.message(); } };
    const consume = async () => {
      if (!stopped || !decided || consumed) return;
      consumed = true; const result = stopped;
      if (!this.valid(epoch) || this.cancelled) { release(); disposeOriginal(result); return; }
      detach();
      try {
        const data = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: result.tempFilePath, encoding: 'base64', success: r => resolve(r.data), fail: reject }));
        if (this.valid(epoch)) await this.upload(data);
      } catch (_) { if (this.valid(epoch)) { this.setBusy(false); this.message(); } }
      finally { release(); disposeOriginal(result); if (this.valid(epoch)) this.setBusy(!!this.asset && ACTIVE.includes(this.asset.status)); }
    };
    this.onStop = result => { stopped = result; this.recordingPath = result.tempFilePath; if (!this.valid(epoch) || this.cancelled) { detach(); release(); disposeOriginal(result); return; } return consume(); };
    this.recorder.onStop(this.onStop); this.recorder.onError(this.onError); this.setBusy(true);
    try { this.recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'wav' }); }
    catch (_) { detach(); release(); this.setBusy(false); this.message(); return; }
    const choice = await invoke('showModal', { title: '正在录音', content: '说完后结束录音，转成文字后可修改再发送。最长60秒。', confirmText: '结束录音', cancelText: '取消' }).catch(() => ({ cancel: true }));
    if (!this.valid(epoch) || !this.recorder) return;
    decided = true; this.cancelled = !choice.confirm; if (!stopped) manager.stop();
    if (this.cancelled) { if (stopped) { detach(); release(); disposeOriginal(stopped); } this.setBusy(false); }
    else await consume();
  }
  async upload(data) {
    const epoch = this.epoch; this.setBusy(true);
    try {
      await this.client.mutate('speech-upload:' + this.base, '', { data });
      if (this.valid(epoch)) await this.refresh();
    } catch (error) { if (this.valid(epoch)) { this.setBusy(false);
      this.message(uncertain(error) ? '录音上传结果待核对，可从麦克风核对同一次上传。' : '这段录音未能上传，请重新录音或改用文字。');
      if (!uncertain(error)) this.asset = null; } }
  }
  stopPlayback() {
    if (this.player) { this.player.stop(); this.player.destroy(); this.player = null; }
    if (this.audioPath) { try { wx.getFileSystemManager().unlink({ filePath: this.audioPath, fail() {} }); } catch (_) {} this.audioPath = ''; }
  }
  async play(id) {
    this.stopPlayback(); const epoch = this.epoch;
    const result = await api.downloadFile(this.base + '/' + id, { suppressUnauthorized: true });
    if (!this.valid(epoch) || result.statusCode !== 200) {
      if (result.tempFilePath) try { wx.getFileSystemManager().unlink({ filePath: result.tempFilePath, fail() {} }); } catch (_) {}
      if (this.valid(epoch)) this.message(); return;
    }
    this.audioPath = result.tempFilePath; this.player = wx.createInnerAudioContext(); this.player.src = result.tempFilePath;
    this.player.onEnded(() => this.stopPlayback()); this.player.onError(() => { this.stopPlayback(); if (this.valid(epoch)) this.message(); }); this.player.play();
  }
}
module.exports = { SpeechController };
