const api = require('../../../utils/api');
const { loadSiteFont } = require('../lib/site-font');
const empty = () => ({ loading:true, detail:null, src:'', playerEpoch:0, state:'connecting', error:'', paused:false, navTop:47, navRight:100, navHeight:44 });
const validId = v => /^[1-9]\d{0,18}$/.test(String(v||''));
const withdrawn = error => [401,403,404].includes(error.statusCode) || error.code === 'public_live_unavailable';
const connectionError = '暂时无法连接直播，请重试。';
function sourceUrl(url) {
  if(typeof url!=='string')throw {code:'invalid_response'};
  const path=url.replace(/^(?:https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)(?=\/)/,'');
  if(!/^\/api\/public\/construction-live\/[1-9]\d*\/[a-f0-9]{48}\/media\/[A-Za-z0-9_-]{43}\/hls\.m3u8$/.test(path))throw {code:'invalid_response'};
  return path===url?api.getBaseUrls()[0].replace(/\/api$/,'')+url:url;
}
Page({
  data:empty(),
  onLoad(options) {
    loadSiteFont();
    this.options=options||{};this.alive=true;this.epoch=0;
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();let cap;try{cap=wx.getMenuButtonBoundingClientRect();}catch(_){}
    this.setData({navTop:Math.max(info.statusBarHeight||24,(cap?.top||47)-6),navRight:Math.max(96,info.windowWidth-(cap?.left||info.windowWidth-96)+10)});
  },
  onShow() {this.visible=true;this.connect();},
  onHide() {this.clear();},
  onUnload() {this.alive=false;this.clear();},
  clear() {this.visible=false;this.epoch++;clearInterval(this.poll);clearTimeout(this.renew);try{wx.createVideoContext('public-live-video',this).stop();}catch(_){}this.setData({src:'',state:'stopped',paused:false});},
  async read(suffix='',method='GET') {
    const r=await api.request('/public/construction-live/'+this.options.enterpriseId+'/'+this.options.key+suffix,method,{}, {suppressUnauthorized:true});
    if(!r?.success||!r.data)throw {code:r?.code||'invalid_response'};return r.data;
  },
  async connect() {
    clearInterval(this.poll);clearTimeout(this.renew);const epoch=++this.epoch;
    if(!validId(this.options.enterpriseId)||!/^[a-f0-9]{48}$/.test(String(this.options.key||''))){this.setData({loading:false,src:'',state:'stopped',error:'请从有效的公开直播入口进入。'});return;}
    this.setData({loading:true,src:'',state:'connecting',error:'',paused:false});
    const valid=()=>this.alive&&this.visible&&epoch===this.epoch;
    try {
      const detail=await this.read();if(!valid())return;this.setData({detail});
      const session=await this.read('/session','POST');if(!valid())return;
      if(session.key!==detail.key||session.versionId!==detail.versionId||session.revision!==detail.revision)throw {code:'public_live_unavailable'};
      this.setData({src:sourceUrl(session.url),playerEpoch:epoch,loading:false});
      this.poll=setInterval(()=>this.check(epoch),5000);
      this.renew=setTimeout(()=>{if(valid()&&!this.data.paused)this.connect();},90000);
    }catch(error){if(valid()){const stopped=withdrawn(error);this.setData({src:'',loading:false,state:stopped?'stopped':'failed',error:stopped?'直播已停止公开':connectionError});}}
  },
  async check(epoch) {
    if(this.checking)return;this.checking=true;
    try {const detail=await this.read();if(epoch!==this.epoch||!this.visible)return;
      if(detail.versionId!==this.data.detail?.versionId||detail.revision!==this.data.detail?.revision)throw {code:'public_live_unavailable'};
    }catch(error){if(epoch===this.epoch&&this.visible){const stopped=withdrawn(error);try{wx.createVideoContext('public-live-video',this).stop();}catch(_){}this.setData({src:'',state:stopped?'stopped':'failed',error:stopped?'直播已停止公开':'暂时无法核对直播状态，请重试。',paused:false});clearInterval(this.poll);clearTimeout(this.renew);}}
    finally{this.checking=false;}
  },
  isCurrentPlayer(event) {
    return this.data.src && Number(event?.currentTarget?.dataset?.playerEpoch) === this.epoch;
  },
  played(event) {
    const time = event.detail.currentTime;
    if (this.isCurrentPlayer(event) && this.data.state === 'connecting' && Number.isFinite(time) && time > 0) {
      this.setData({state:'playing',error:''});
    }
  },
  playbackError(event) {
    if (!this.isCurrentPlayer(event)) return;
    clearTimeout(this.renew);
    this.setData({src:'',loading:false,state:'failed',error:connectionError,paused:false});
  },
  toggle() {
    if (this.data.state === 'paused') return this.connect();
    if (this.data.state !== 'playing') return;
    try { wx.createVideoContext('public-live-video',this).pause(); } catch (_) { return; }
    this.setData({paused:true,state:'paused'});
  },
  fullscreen() {if(this.data.src)wx.createVideoContext('public-live-video',this).requestFullScreen({direction:90});},
  retry() {return this.connect();},
  back() {wx.navigateBack({fail:()=>{if(validId(this.options.siteId)&&validId(this.options.versionId))wx.redirectTo({url:'/packages/construction/public-site/public-site?enterpriseId='+this.options.enterpriseId+'&siteId='+this.options.siteId+'&versionId='+this.options.versionId});else wx.redirectTo({url:'/packages/construction/public-sites/public-sites?enterpriseId='+this.options.enterpriseId});}});},
  consult() {wx.navigateTo({url:'/packages/assistant/chat/chat?'+(validId(this.options.conversationId)?'conversationId='+this.options.conversationId:'publicEnterpriseId='+this.options.enterpriseId)});},
  designer() {wx.navigateTo({url:'/packages/assistant/chat/chat?publicEnterpriseId='+this.options.enterpriseId+'&findDesigner=1'});},
  onShareAppMessage() {return {title:(this.data.detail?.name||'工地')+' · 公开直播',path:'/packages/construction/public-live/public-live?enterpriseId='+this.options.enterpriseId+'&key='+this.options.key};},
});
