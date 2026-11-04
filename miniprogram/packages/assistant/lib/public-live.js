const api = require('../../../utils/api');
const { uncertain } = require('../../../utils/assistant-client');
const initialLive = () => ({ liveCards: {}, liveExpanded: '', liveBusy: false, liveError: '', livePending: false, livePreviewUrl: '', livePreviewReady: false, livePreviewAttempt: 0, publicLiveEntry: null });
const copy = error => ({ public_live_source_changed: '机位、业主或访问范围已有变化，请重新读取。', public_live_preview_required: '请先查看这一版的全部画面与观看范围。',
  public_live_state_conflict: '直播状态已变化，请重新读取。', public_live_unavailable: '直播已停止公开或当前无权查看。', version_conflict: '版本已有更新，请重新核对，不会沿用旧决定。',
  public_live_tracks_unverified: '暂时无法确认无声画面，请稍后重试。', public_live_media_unknown: '连接结果尚未确认，请先核对最新状态。',
  public_live_not_configured: '直播服务暂不可用，请稍后重试。' })[error && (error.code || error.error)] || '暂时无法连接，请重试；未确认的操作会保留。';
function scope(value) { let n = 2166136261; for (let i=0;i<value.length;i++) n=Math.imul(n^value.charCodeAt(i),16777619); return (n>>>0).toString(16); }
function mediaUrl(url) {
  if (typeof url !== 'string') throw { code: 'invalid_response' };
  const path=url.replace(/^(?:https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)(?=\/)/,'');
  if (!/^\/api\/public\/construction-live\/[1-9]\d*\/[a-f0-9]{48}\/media\/[A-Za-z0-9_-]{43}\/hls\.m3u8$/.test(path)) throw { code: 'invalid_response' };
  return path===url?api.getBaseUrls()[0].replace(/\/api$/, '')+url:url;
}
class LiveConsentController {
  constructor({emit,identity,request=api.request}) { Object.assign(this,{emit,identity,request}); this.state=initialLive(); this.epoch=0; this.previewGeneration=0; this.previewScope=null; }
  set(p) { Object.assign(this.state,p); this.emit(p); }
  resetPreview(p={}) { this.previewScope=null;this.set({livePreviewUrl:'',livePreviewReady:false,livePreviewAttempt:++this.previewGeneration,...p}); }
  clear() { this.epoch++;this.previewGeneration++;this.previewScope=null;this.cid='';this.set(initialLive()); }
  valid(epoch) { return epoch===this.epoch && this.session===this.identity(); }
  storage() { return 'public-live:'+scope(this.session)+':'+this.cid; }
  pending() { try { return wx.getStorageSync(this.storage()) || null; } catch (_) { return this.operation || null; } }
  savePending(value) { this.operation=value;try { if(value)wx.setStorageSync(this.storage(),value);else wx.removeStorageSync(this.storage()); } catch (_) {} }
  async read(path,method='GET',body={},headers={}) { const r=await this.request(path,method,body,{suppressUnauthorized:true,headers}); if(!r?.success || !r.data || typeof r.data!=='object')throw {code:r?.code||r?.error||'invalid_response'};return r.data; }
  async load(cid) {
    if(!/^[1-9]\d*$/.test(String(cid||''))) {this.clear();return;}
    if(this.cid!==cid||this.session!==this.identity())this.clear();
    this.cid=cid;this.session=this.identity();if(this.state.liveBusy)return;
    const epoch=++this.epoch;
    try { const data=await this.read('/miniprogram/assistant/public-live/'+cid);if(!this.valid(epoch))return;
      const cards={};for(const card of data.items||[]) {if(!card.id||!card.versionId||!card.messageId)throw {code:'invalid_response'};cards[card.messageId]=card;}
      const previous=this.card(this.state.liveExpanded);
      const expanded=Object.values(cards).find(c=>c.id===this.state.liveExpanded&&c.available&&c.versionId===previous?.versionId&&c.revision===previous?.revision);
      const patch={liveCards:cards,livePending:!!this.pending()};
      if(expanded)this.set(patch);else this.resetPreview({...patch,liveExpanded:'',liveError:''});
    }catch(error){if(this.valid(epoch)){this.resetPreview({liveCards:{},liveExpanded:'',liveError:copy(error),livePending:!!this.pending()});}}
  }
  async entry(eid,siteId) {
    const epoch=this.epoch,session=this.identity();this.set({publicLiveEntry:null});
    try {const r=await this.request('/public/construction-live/'+eid+'/site/'+siteId,'GET',{}, {suppressUnauthorized:true});if(epoch===this.epoch&&session===this.identity())this.set({publicLiveEntry:r?.success?r.data:null});}catch(_){if(epoch===this.epoch)this.set({publicLiveEntry:null});}
  }
  card(id) {return Object.values(this.state.liveCards).find(c=>c.id===id);}
  currentPreview(id,attempt=this.state.livePreviewAttempt) {
    const c=this.card(id),p=this.previewScope;
    return !!(c?.available&&p&&this.session===this.identity()&&this.state.liveExpanded===id&&attempt===this.state.livePreviewAttempt&&p.attempt===attempt&&p.id===id&&p.versionId===c.versionId&&p.revision===c.revision&&p.url===this.state.livePreviewUrl);
  }
  async decide(id,action) {
    const c=this.card(id);if(!c||this.state.liveBusy||this.pending())return false;
    if(this.session!==this.identity()||!['preview','approve','decline','later','withdraw'].includes(action))return false;
    if(action==='withdraw'?!c.canWithdraw:!c.available||!c.canDecide)return false;
    if(action==='approve'&&(!this.state.livePreviewReady||!this.currentPreview(id)))return false;
    return this.write({key:'public-live.'+Date.now()+'.'+Math.random().toString(36).slice(2),path:'/miniprogram/assistant/public-live/'+this.cid+'/'+id+'/'+action,
      body:{versionId:c.versionId,expectedRevision:c.revision},action,id});
  }
  async write(op) {
    const epoch=this.epoch;this.savePending(op);this.resetPreview({liveBusy:true,livePending:true,liveError:''});
    try {const r=await this.read(op.path,'POST',op.body,{'Idempotency-Key':op.key});if(!this.valid(epoch))return false;
      const status={preview:'pending_owner',later:'pending_owner',approve:'owner_approved',decline:'declined',withdraw:'withdrawn'}[op.action];
      if(r.id!==op.id||r.versionId!==op.body.versionId||r.revision!==op.body.expectedRevision+1||r.status!==status)throw {uncertain:true,code:'invalid_response'};
      this.savePending(null);this.set({livePending:false,liveExpanded:op.action==='preview'?op.id:'',liveError:r.stopped===false?'公开权限已撤回，媒体清理待确认。':''});
      const cards={...this.state.liveCards};for(const k of Object.keys(cards))if(cards[k].id===op.id)cards[k]={...cards[k],...r,...(r.material||{}),canDecide:r.status==='pending_owner',canWithdraw:['pending_owner','owner_approved','published'].includes(r.status)};
      this.set({liveCards:cards});if(op.action==='preview')await this.preview(op.id);return true;
    }catch(error){if(this.valid(epoch)){if(!uncertain(error)&&!error.uncertain)this.savePending(null);this.resetPreview({liveError:uncertain(error)||error.uncertain?'结果尚未确认，请核对同一次操作。':copy(error),livePending:!!this.pending()});}return false;}
    finally{if(this.valid(epoch))this.set({liveBusy:false});}
  }
  async preview(id) {
    const c=this.card(id);if(!c?.available||this.state.liveExpanded!==id||this.pending()||this.session!==this.identity())return false;
    const epoch=this.epoch;this.resetPreview({liveError:''});const attempt=this.state.livePreviewAttempt;
    const valid=()=>this.valid(epoch)&&attempt===this.state.livePreviewAttempt&&this.state.liveExpanded===id&&this.card(id)?.versionId===c.versionId&&this.card(id)?.revision===c.revision;
    try {const r=await this.read('/miniprogram/assistant/public-live/'+this.cid+'/'+id+'/session','POST',{versionId:c.versionId});if(!valid())return false;
      const url=mediaUrl(r.url);this.previewScope={id,versionId:c.versionId,revision:c.revision,attempt,url};this.set({livePreviewUrl:url});return true;}
    catch(error){if(valid())this.resetPreview({liveError:copy(error)});return false;}
  }
  retry() {const op=this.pending();return op?this.write(op):this.load(this.cid);}
  playbackProgress(id,attempt,time) {if(this.currentPreview(id,attempt)&&Number.isFinite(time)&&time>0)this.set({livePreviewReady:true});}
  playbackFailed(id,attempt) {if(this.currentPreview(id,attempt))this.resetPreview({liveError:'暂时无法连接直播，可以重试预览；请仍仔细核对观看范围。'});}
}
module.exports={LiveConsentController,initialLive,liveError:copy,mediaUrl};
