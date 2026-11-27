const api = require('../../../utils/api');
const { loadSiteFont } = require('../lib/site-font');
const { publicConsultationId } = require('../../../utils/public-site-client');
const { aiEntriesEnabled, syncAiEntryVisibility } = require('../../../utils/ai-entries');
const { brandShareCover } = require('../../../utils/share-cover');
const empty = () => ({ loading:true, detail:null, src:'', playerEpoch:0, state:'connecting', error:'', paused:false, shareAvailable:false, canConsult:false, guideQuestion:'', navTop:47, navRight:100, navHeight:44 });
const validId = v => /^[1-9]\d{0,18}$/.test(String(v||''));
const withdrawn = error => [401,403,404].includes(error.statusCode) || error.code === 'public_live_unavailable';
const connectionError = '暂时无法连接直播，请重试。';
const bufferRecoveryMs = 8000;
const shareCover = '/packages/construction/assets/notebook/public-live-share-cover.jpg';
function isBufferStall(detail) {
  if (detail?.fatal === true) return false;
  // Stable can report the HLS detail only in errMsg.
  return detail?.details === 'bufferStalledError'
    || /^HLS error, type: mediaError, details: bufferStalledError(?:,|$)/.test(detail?.errMsg || '');
}
function sourceUrl(url) {
  if(typeof url!=='string')throw {code:'invalid_response'};
  const path=url.replace(/^(?:https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)(?=\/)/,'');
  if(!/^\/api\/public\/construction-live\/[1-9]\d*\/[a-f0-9]{48}\/media\/[A-Za-z0-9_-]{43}\/hls\.m3u8$/.test(path))throw {code:'invalid_response'};
  return path===url?api.getBaseUrls()[0].replace(/\/api$/,'')+url:url;
}
Page({
  data: { ...empty(), aiEntriesEnabled: false },
  onLoad(options) {
    loadSiteFont();
    this.options=options||{};this.alive=true;this.epoch=0;
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();let cap;try{cap=wx.getMenuButtonBoundingClientRect();}catch(_){}
    this.setData({navTop:Math.max(info.statusBarHeight||24,(cap?.top||47)-6),navRight:Math.max(96,info.windowWidth-(cap?.left||info.windowWidth-96)+10)});
  },
  onShow() {
    this.visible = true;
    this.syncAiEntryVisibility();
    const ticket = this.consultTicket = (this.consultTicket || 0) + 1;
    if (validId(this.options.conversationId)) void publicConsultationId(this.options).then(cid => {
      if (this.alive && this.visible && this.consultTicket === ticket) {
        this.consultationId = cid; this.setData({ canConsult: !!cid });
        void this.loadGuide();
      }
    });
    this.connect();
  },
  syncAiEntryVisibility,
  onHide() {this.clear();},
  onUnload() {this.alive=false;this.clear();},
  clear() {this.visible=false;this.epoch++;this.consultationId='';clearInterval(this.poll);clearTimeout(this.renew);this.clearBufferRecovery();this.stopPlayer();this.setData({src:'',state:'stopped',paused:false,shareAvailable:false,canConsult:false,guideQuestion:''});},
  stopPlayer() {
    try { this.selectComponent?.('#public-live-player')?.stop(); } catch (_) {}
  },
  setShareAvailable(shareAvailable) {
    this.setData({ shareAvailable, ...(shareAvailable ? {} : { guideQuestion: '' }) });
    const options = { menus: ['shareAppMessage'] };
    if (shareAvailable) wx.showShareMenu?.(options);
    else wx.hideShareMenu?.(options);
  },
  async read(suffix='',method='GET') {
    const r=await api.request('/public/construction-live/'+this.options.enterpriseId+'/'+this.options.key+suffix,method,{}, {suppressUnauthorized:true});
    if(!r?.success||!r.data)throw {code:r?.code||'invalid_response'};return r.data;
  },
  async loadGuide() {
    const cid = this.consultationId;
    const { siteId, versionId } = this.options;
    const { key: liveKey, versionId: liveVersionId } = this.data.detail || {};
    if (!cid || !this.data.shareAvailable || !validId(siteId) || !validId(versionId)
      || liveKey !== this.options.key || !validId(liveVersionId)) return;
    const epoch = this.epoch;
    try {
      const result = await api.request(`/miniprogram/assistant/conversations/${cid}/public-sites/${siteId}/guide`,
        'GET', { versionId, liveKey, liveVersionId }, { suppressUnauthorized: true });
      const text = result?.data?.question;
      if (this.alive && this.visible && epoch === this.epoch && this.consultationId === cid && this.data.shareAvailable)
        this.setData({ guideQuestion: result?.success && typeof text === 'string' ? text : '' });
    } catch (_) { /* The standard consultation entry stays available. */ }
  },
  async connect() {
    clearInterval(this.poll);
    clearTimeout(this.renew);
    this.clearBufferRecovery();
    this.lastPlaybackTime = 0;
    const epoch = ++this.epoch;
    this.setShareAvailable(false);
    if (!validId(this.options.enterpriseId) || !/^[a-f0-9]{48}$/.test(String(this.options.key || ''))) {
      this.setData({ loading:false, src:'', state:'stopped', error:'请从有效的公开直播入口进入。' });
      return;
    }
    this.setData({ loading:true, src:'', state:'connecting', error:'', paused:false });
    const valid = () => this.alive && this.visible && epoch === this.epoch;
    try {
      const detail = await this.read();
      if (!valid()) return;
      if (detail.key !== this.options.key) throw { code:'public_live_unavailable' };
      this.setData({ detail });
      this.setShareAvailable(true);
      void this.loadGuide();
      this.poll = setInterval(() => this.check(epoch), 5000);

      const session = await this.read('/session', 'POST');
      if (!valid()) return;
      if (session.key !== detail.key || session.versionId !== detail.versionId || session.revision !== detail.revision) {
        throw { code:'public_live_unavailable' };
      }
      this.setData({ src:sourceUrl(session.url), playerEpoch:epoch, loading:false });
      this.renew = setTimeout(() => { if (valid() && !this.data.paused) this.connect(); }, 90000);
    } catch (error) {
      if (!valid()) return;
      const stopped = withdrawn(error);
      if (stopped) {
        ++this.epoch;
        clearInterval(this.poll);
        this.setShareAvailable(false);
      }
      this.setData({ src:'', loading:false, state:stopped ? 'stopped' : 'failed', error:stopped ? '直播已停止公开' : connectionError });
    }
  },
  async check(epoch) {
    if (epoch !== this.epoch || !this.visible || this.checking) return;
    this.checking = true;
    try {
      const detail = await this.read();
      if (epoch !== this.epoch || !this.visible) return;
      const current = this.data.detail;
      if (!current || detail.key !== current.key || detail.versionId !== current.versionId || detail.revision !== current.revision) {
        throw { code:'public_live_unavailable' };
      }
    } catch (error) {
      if (epoch !== this.epoch || !this.visible) return;
      ++this.epoch;
      clearInterval(this.poll);
      clearTimeout(this.renew);
      this.clearBufferRecovery();
      this.setShareAvailable(false);
      this.stopPlayer();
      const stopped = withdrawn(error);
      this.setData({ src:'', loading:false, paused:false, state:stopped ? 'stopped' : 'failed',
        error:stopped ? '直播已停止公开' : '暂时无法核对直播状态，请重试。' });
    } finally {
      this.checking = false;
    }
  },
  isCurrentPlayer(event) {
    return this.data.src && event.detail?.epoch === this.epoch;
  },
  played(event) {
    const time = event.detail?.currentTime;
    if (!this.isCurrentPlayer(event) || !Number.isFinite(time) || time <= (this.lastPlaybackTime || 0)) return;
    this.lastPlaybackTime = time;
    this.clearBufferRecovery();
    if (this.data.state === 'connecting') this.setData({ state: 'playing', error: '' });
  },
  playbackError(event) {
    if (!this.isCurrentPlayer(event)) return;
    if (!isBufferStall(event.detail)) return this.failPlayback();
    if (this.data.paused || this.bufferRecovery !== undefined) return;
    const epoch = this.epoch;
    this.bufferRecovery = setTimeout(() => {
      this.bufferRecovery = undefined;
      if (this.alive && this.visible && epoch === this.epoch && this.data.src) this.failPlayback();
    }, bufferRecoveryMs);
  },
  clearBufferRecovery() {
    if (this.bufferRecovery === undefined) return;
    clearTimeout(this.bufferRecovery);
    this.bufferRecovery = undefined;
  },
  failPlayback() {
    this.clearBufferRecovery();
    clearTimeout(this.renew);
    this.setData({src:'',loading:false,state:'failed',error:connectionError,paused:false});
  },
  pause(event) {
    if (!this.isCurrentPlayer(event) || this.data.state !== 'playing') return;
    this.clearBufferRecovery();
    this.setData({paused:true,state:'paused'});
  },
  retry() {return this.connect();},
  back() {wx.navigateBack({fail:()=>{if(validId(this.options.siteId)&&validId(this.options.versionId))wx.redirectTo({url:'/packages/construction/public-site/public-site?enterpriseId='+this.options.enterpriseId+'&siteId='+this.options.siteId+'&versionId='+this.options.versionId});else wx.redirectTo({url:'/packages/construction/public-sites/public-sites?enterpriseId='+this.options.enterpriseId});}});},
  consult(event) {
    if (!aiEntriesEnabled() || !this.consultationId || !this.visible || !this.data.shareAvailable) return;
    const values = {
      conversationId: this.consultationId,
      ...(validId(this.options.siteId) && validId(this.options.versionId) ? { publicSiteId: this.options.siteId, publicVersionId: this.options.versionId } : {}),
      ...(event?.currentTarget?.dataset.designer ? { findDesigner: '1' } : {}),
    };
    wx.navigateTo({ url: '/packages/assistant/chat/chat?' + Object.entries(values).map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&') });
  },
  onShareAppMessage() {
    if (!this.data.shareAvailable) return { title: '家客来', path: '/pages/index/index', imageUrl: brandShareCover };
    const { enterpriseId, key } = this.options;
    return {
      title: this.data.detail.name || '公开工地直播',
      path: `/packages/construction/public-live/public-live?enterpriseId=${enterpriseId}&key=${key}`,
      imageUrl: shareCover,
    };
  },
});
