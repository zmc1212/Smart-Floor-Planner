import { fail } from '@/lib/assistant/contracts';
import { cameraWvp, mediaPart, type CameraStream } from '../camera/wvp';
import { guardLiveWriter } from '../camera/writer-policy';

type Json=Record<string,unknown>;
export interface LiveUpstream {
  source(eid:string,bindingId:string,deviceId:string,channelId:string):Promise<CameraStream>;
  create(app:string,stream:string,source:CameraStream):Promise<void>;
  inspect(app:string,stream:string):Promise<{exists:boolean;silent:boolean}>;
  remove(app:string,stream:string,ownershipKey:string):Promise<void>;
  media(app:string,stream:string,resource:string,signal:AbortSignal):Promise<Response>;
}
/** Dedicated server-owned relay. No private origin or source identifier is sent to a viewer. */
export class ZlmPublicLive implements LiveUpstream {
  readonly origin:string;
  constructor(readonly config:{origin:string;secret:string;sourceOrigin:string},readonly transport:typeof fetch=fetch) {
    const u=new URL(config.origin),source=new URL(config.sourceOrigin);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash
      ||!['rtsp:','rtmp:','http:','https:'].includes(source.protocol)||source.username||source.password||source.pathname!=='/'||source.search||source.hash)fail('public_live_not_configured',503);
    this.origin=u.origin;
  }
  async source(eid:string,bindingId:string,deviceId:string,channelId:string) {
    const wvp=cameraWvp(),s=await wvp.play(deviceId,channelId);
    await guardLiveWriter(eid,bindingId,s,wvp);return s;
  }
  private async api(method:string,args:Record<string,string>) {
    const u=new URL('/index/api/'+method,this.origin);u.search=new URLSearchParams({secret:this.config.secret,...args}).toString();
    let r:Response;try{r=await this.transport(u,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('public_live_media_unknown',503);}
    if(!r.ok)fail('public_live_media_unavailable',503);
    let result:Json;try{result=await r.json();}catch{fail('public_live_media_unknown',503);}
    if(result.code!==0)fail('public_live_media_unavailable',503);return result;
  }
  async create(app:string,stream:string,source:CameraStream) {
    if(app!=='sfp_public_live')fail('public_live_forbidden',403);
    const url=new URL(`${mediaPart(source.app)}/${mediaPart(source.stream)}`,this.config.sourceOrigin).href;
    const r=await this.api('addStreamProxy',{vhost:'__defaultVhost__',app,stream:mediaPart(stream),url,
      enable_audio:'0',add_mute_audio:'0',enable_mp4:'0',enable_hls:'1',enable_rtsp:'1',enable_rtmp:'0',enable_ts:'0',enable_fmp4:'0',enable_rtc:'0',
      retry_count:'0',rtp_type:'0',auto_close:'0',hls_demand:'0',rtsp_demand:'0'});
    if((r.data as Json)?.key!==`__defaultVhost__/${app}/${stream}`)fail('public_live_media_unknown',503);
  }
  async inspect(app:string,stream:string) {
    const r=await this.api('getMediaList',{vhost:'__defaultVhost__',app:mediaPart(app),stream:mediaPart(stream)});
    if(r.data!==undefined&&!Array.isArray(r.data))fail('public_live_media_unknown',503);
    const media=(r.data||[]) as Json[];
    const tracks=media.flatMap(m=>Array.isArray(m.tracks)?m.tracks as Json[]:[]);
    return {exists:media.length>0,silent:tracks.some(t=>Number(t.codec_type)===0&&t.ready===true)&&!tracks.some(t=>Number(t.codec_type)===1)};
  }
  async remove(app:string,stream:string,ownershipKey:string) {
    if(app!=='sfp_public_live'||ownershipKey!==`__defaultVhost__/${app}/${mediaPart(stream)}`)fail('public_live_forbidden',403);
    // API is key-scoped; it never closes the shared WVP source.
    await this.api('delStreamProxy',{key:ownershipKey});
    const proxies=await this.api('listStreamProxy',{});
    // This pinned build omits data for the successful empty list. Still require
    // code=0 and independent media absence before acknowledging removal.
    if(proxies.data!==undefined&&!Array.isArray(proxies.data))fail('public_live_media_unknown',503);
    if(((proxies.data||[]) as Json[]).some((p:Json)=>p.key===ownershipKey||p.app===app&&p.stream===stream))fail('public_live_stop_unconfirmed',503);
    if((await this.inspect(app,stream)).exists)fail('public_live_stop_unconfirmed',503);
  }
  media(app:string,stream:string,resource:string,signal:AbortSignal) {
    return this.transport(new URL(`/${mediaPart(app)}/${mediaPart(stream)}/${resource}`,this.origin),{cache:'no-store',redirect:'error',signal});
  }
}
let singleton:LiveUpstream|undefined;
export function publicLiveUpstream():LiveUpstream {
  if(!singleton){
    const origin=process.env.PUBLIC_LIVE_ZLM_ORIGIN,secret=process.env.PUBLIC_LIVE_ZLM_SECRET,sourceOrigin=process.env.PUBLIC_LIVE_SOURCE_ORIGIN;
    if(!origin||!secret||!sourceOrigin)fail('public_live_not_configured',503);
    singleton=new ZlmPublicLive({origin,secret,sourceOrigin});
  }
  return singleton;
}
