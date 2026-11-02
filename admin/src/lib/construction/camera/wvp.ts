import { createHash } from 'node:crypto';
import { fail } from '@/lib/assistant/contracts';

type Json = Record<string, unknown>;
// WVP uses GET for both reads and device commands. Only these observational
// endpoints may be replayed once after an explicit authentication rejection.
const authenticationRecoveryReads = new Set([
  '/api/record/plan/channel/list', '/api/record/plan/query', '/api/record/plan/get',
  '/api/cloud/record/list', '/api/cloud/record/play/path',
]);
export type CameraChannel = { deviceId: string; channelId: string; name: string; online: boolean; ptzType: number };
export type CameraStream = { app: string; stream: string };
export type PtzCommand = 'left' | 'right' | 'up' | 'down' | 'stop';
export const gbId = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{20}$/.test(value)) fail('camera_invalid_channel', 422);
  return value;
};
export function mediaPart(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) fail('camera_invalid_stream', 502);
  return value;
}
function base(value: string) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('Invalid camera service origin');
  return u.origin;
}
export class WvpClient {
  private token = '';
  private loginPending?: Promise<string>;
  readonly origin: string;
  readonly mediaOrigin: string;
  constructor(private readonly config: { origin: string; mediaOrigin: string; username: string; password: string; mediaSecret?: string }, private readonly transport: typeof fetch = fetch) {
    this.origin = base(config.origin); this.mediaOrigin = base(config.mediaOrigin);
  }
  private async raw(path: string, params: Record<string, string> = {}, authenticated = true, timeout = 15000, operation?: {method:'POST'|'DELETE';body:unknown}) {
    const url = new URL(path, this.origin); url.search = new URLSearchParams(params).toString();
    const recover = authenticated && !operation && (authenticationRecoveryReads.has(path)
      || /^\/api\/device\/query\/devices\/\d{20}\/channels$/.test(path));
    const request = async () => {
      const token = authenticated ? await this.login() : '';
      try {
        const response = await this.transport(url, { headers: { ...(authenticated ? { 'access-token': token } : {}),...(operation?{'Content-Type':'application/json'}:{}) },...(operation?{method:operation.method,body:JSON.stringify(operation.body)}:{}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeout) });
        return { response, token };
      } catch { fail('camera_service_unavailable', 503); }
    };
    let { response, token } = await request();
    const rejectToken = async () => {
      // A late rejection for an older request must not evict a newer token.
      if (authenticated && this.token === token) this.token = '';
      await response.body?.cancel().catch(() => undefined);
    };
    if (response.status === 401 && recover) {
      await rejectToken();
      ({ response, token } = await request());
    }
    if (response.status === 401) { await rejectToken(); fail('camera_service_auth_failed', 503); }
    if (!response.ok) fail('camera_service_unavailable', 503);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) fail('camera_invalid_response', 502);
    if (!body.trim()) return null;
    let data: unknown;
    try { data = JSON.parse(body); } catch { return body; }
    if (data && typeof data === 'object' && 'code' in data) {
      const envelope = data as Json;
      if (Number(envelope.code) !== 0) {
        if(path==='/api/cloud/record/play/path'&&Number(envelope.code)===400&&envelope.msg==='资源不存在')return undefined;
        fail('camera_operation_failed', 502);
      }
      return envelope.data ?? null;
    }
    return data;
  }
  private async login(): Promise<string> {
    if (this.token) return this.token;
    if (!this.loginPending) this.loginPending = (async () => {
      const r = await this.raw('/api/user/login', { username: this.config.username, password: createHash('md5').update(this.config.password).digest('hex') }, false) as Json;
      if (typeof r?.accessToken !== 'string' || !r.accessToken) fail('camera_service_auth_failed', 503);
      return this.token = r.accessToken;
    })().finally(() => { this.loginPending = undefined; });
    return this.loginPending;
  }
  async channels(deviceId: string): Promise<CameraChannel[]> {
    gbId(deviceId);
    const result = await this.raw(`/api/device/query/devices/${deviceId}/channels`, { page: '1', count: '1000' }) as Json;
    if (!Array.isArray(result?.list)) fail('camera_invalid_response', 502);
    return result.list.filter((c: Json) => typeof c.deviceId === 'string' && /^\d{20}$/.test(c.deviceId)).map((c: Json) => ({
      deviceId, channelId: String(c.deviceId), name: String(c.name || c.deviceId), online: c.status === 'ON' || c.status === 1,
      ptzType: Number(c.ptzType || 0),
    }));
  }
  async play(deviceId: string, channelId: string): Promise<CameraStream> {
    const result = await this.raw(`/api/play/start/${gbId(deviceId)}/${gbId(channelId)}`) as Json;
    return { app: mediaPart(result?.app), stream: mediaPart(result?.stream) };
  }
  async recordingChannel(deviceId:string,channelId:string,ownedPlanId?:number|null) {
    const result=await this.raw(`/api/device/query/devices/${gbId(deviceId)}/channels`,{page:'1',count:'1000'}) as Json;
    const c=Array.isArray(result?.list)?result.list.find((r:Json)=>r.deviceId===gbId(channelId)):undefined;
    if(!c||!Number.isSafeInteger(c.id)||Number(c.id)<1)fail('camera_invalid_channel',502);
    // This pinned build omits record_plan_id from the device DTO and emits
    // recordPLan:null even for linked channels. Read the actual plan membership.
    const linked=async(planId:number)=>{const r=await this.raw('/api/record/plan/channel/list',{page:'1',count:'1000',hasLink:'true',planId:String(planId)}) as Json;
      if(!Array.isArray(r?.list))fail('camera_invalid_response',502);return r.list.some((row:Json)=>Number(row.gbId)===Number(c.id)&&row.gbDeviceId===channelId);};
    const owned=ownedPlanId?await linked(ownedPlanId):false;
    if(owned)return {id:Number(c.id),planId:ownedPlanId!};
    // The controller requires a planId even though its API annotation says
    // optional. Enumerate plans to detect foreign ownership without overwriting it.
    const plans=await this.raw('/api/record/plan/query',{page:'1',count:'1000'}) as Json;
    if(!Array.isArray(plans?.list)||Number(plans.total)>1000)fail('camera_recording_conflict',409);
    for(const plan of plans.list)if(Number(plan.id)!==ownedPlanId&&await linked(Number(plan.id)))return {id:Number(c.id),planId:-1};
    return {id:Number(c.id),planId:null};
  }
  async recordingPlan(name:string,create=false) {
    if(!/^SFP-[a-f0-9-]{36}$/.test(name))fail('camera_invalid_request',422);
    const find=async()=>{const r=await this.raw('/api/record/plan/query',{page:'1',count:'100',query:name}) as Json;
      if(!Array.isArray(r?.list))fail('camera_invalid_response',502);const matches=r.list.filter((p:Json)=>p.name===name);
      if(matches.length>1)fail('camera_recording_conflict',409);return matches[0] as Json|undefined;};
    let plan=await find();
    // Despite legacy half-hour comments, queryCurrentChannelRecord uses minute
    // offsets (hour*60+minute), as does the SQL predicate in this exact version.
    const items=Array.from({length:7},(_,i)=>({weekDay:i+1,start:0,stop:1440}));
    if(!plan&&create){await this.raw('/api/record/plan/add',{},true,15000,{method:'POST',body:{name,snap:false,planItemList:items}});plan=await find();}
    if(!plan)return null;
    if(!Number.isSafeInteger(plan.id)||Number(plan.id)<1)fail('camera_invalid_response',502);
    if(create){const current=await this.raw('/api/record/plan/get',{planId:String(plan.id)}) as Json;
      if(current?.name!==name)fail('camera_recording_conflict',409);
      const parts=current.planItemList;
      if(!Array.isArray(parts)||parts.length!==7||!items.every(item=>parts.some((part:Json)=>part.weekDay===item.weekDay&&part.start===0&&part.stop===1440))){
        await this.raw('/api/record/plan/update',{},true,15000,{method:'POST',body:{id:plan.id,name,snap:false,planItemList:items}});
      }
    }
    return Number(plan.id);
  }
  async linkRecording(channel:number,planId:number|null) {
    await this.raw('/api/record/plan/link',{},true,15000,{method:'POST',body:{channelIds:[channel],planId}});
  }
  async cloudRecordings(stream:CameraStream,from:Date,to:Date,page=1) {
    const {wvpTime}=await import('./recording-contract');
    const r=await this.raw('/api/cloud/record/list',{app:mediaPart(stream.app),stream:mediaPart(stream.stream),page:String(page),count:'100',startTime:wvpTime(from),endTime:wvpTime(to),ascOrder:'true'}) as Json;
    if(!Array.isArray(r?.list)||r.list.length>100)fail('camera_invalid_response',502);
    return {items:r.list,total:Number(r.total||0)};
  }
  async cloudPath(sourceId:number) {
    const r=await this.raw('/api/cloud/record/play/path',{recordId:String(sourceId)}) as Json;
    if(r===undefined)return null;
    if(typeof r?.httpPath!=='string')fail('camera_invalid_recording',502);
    const url=new URL(r.httpPath);
    if(url.pathname!=='/index/api/downloadFile'||url.searchParams.size!==1||!url.searchParams.has('file_path'))fail('camera_invalid_recording',502);
    const {recordingFilePath}=await import('./recording-contract');return recordingFilePath(url.searchParams.get('file_path'));
  }
  async deleteCloudRecording(sourceId:number) { await this.raw('/api/cloud/record/delete',{},true,15000,{method:'DELETE',body:{ids:[sourceId]}}); }
  recordingUrl(filePath:string) {
    if(!this.config.mediaSecret)fail('camera_recording_not_configured',503);
    const url=new URL('/index/api/downloadFile',this.mediaOrigin);url.searchParams.set('file_path',filePath);url.searchParams.set('secret',this.config.mediaSecret);return url;
  }
  async recordingFileStatus(filePath:string){
    // This ZLM build answers HEAD with an empty 200 before dispatching the API,
    // even for missing files. A bounded GET exercises the real file handler.
    try{const r=await this.transport(this.recordingUrl(filePath),{headers:{Range:'bytes=0-0'},redirect:'error',signal:AbortSignal.timeout(10000)});await r.body?.cancel();return r.status;}
    catch{fail('camera_service_unavailable',503);}
  }
  async recordingClock() {
    if(!this.config.mediaSecret)fail('camera_recording_not_configured',503);
    const url=new URL('/index/api/getThreadsLoad',this.mediaOrigin);url.searchParams.set('secret',this.config.mediaSecret);
    let response:Response;try{response=await this.transport(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{fail('camera_service_unavailable',503);}
    const stamp=Date.parse(response.headers.get('date')||'');
    if(!response.ok||!Number.isFinite(stamp)||stamp<946684800000||stamp>4102444800000||(await response.json()).code!==0)fail('camera_recording_clock_unavailable',503);
    // Direct private media origin: this Date must come from ZLM, not a proxy.
    return new Date(stamp);
  }
  async startRecording(stream:CameraStream) {
    if(!this.config.mediaSecret)fail('camera_recording_not_configured',503);
    const url=new URL('/index/api/startRecord',this.mediaOrigin);url.search=new URLSearchParams({secret:this.config.mediaSecret,type:'1',vhost:'__defaultVhost__',app:mediaPart(stream.app),stream:mediaPart(stream.stream),max_second:'3600'}).toString();
    let response:Response;try{response=await this.transport(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{fail('camera_service_unavailable',503);}
    if(!response.ok)fail('camera_service_unavailable',503);const result=await response.json();
    if(result.code!==0||result.result!==true)fail('camera_invalid_response',502);
  }
  async stopRecording(stream:CameraStream) {
    if(!this.config.mediaSecret)fail('camera_recording_not_configured',503);
    const url=new URL('/index/api/stopRecord',this.mediaOrigin);url.search=new URLSearchParams({secret:this.config.mediaSecret,type:'1',vhost:'__defaultVhost__',app:mediaPart(stream.app),stream:mediaPart(stream.stream)}).toString();
    let response:Response;try{response=await this.transport(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{fail('camera_service_unavailable',503);}
    if(!response.ok)fail('camera_service_unavailable',503);const result=await response.json();
    if(result.code!==0||result.result!==true)fail('camera_invalid_response',502);
  }
  async isRecording(stream:CameraStream) {
    if(!this.config.mediaSecret)fail('camera_recording_not_configured',503);
    const url=new URL('/index/api/isRecording',this.mediaOrigin);url.search=new URLSearchParams({secret:this.config.mediaSecret,type:'1',vhost:'__defaultVhost__',app:mediaPart(stream.app),stream:mediaPart(stream.stream)}).toString();
    let response:Response;try{response=await this.transport(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});}catch{fail('camera_service_unavailable',503);}
    if(!response.ok)fail('camera_service_unavailable',503);const r=await response.json();
    // Pinned ZLM returns -500 for an absent stream after WVP closes a recorder.
    // Other provider failures must remain unknown rather than becoming "stopped".
    if(r.code===-500&&r.msg==='can not find the stream')return false;
    if(r.code!==0||typeof r.status!=='boolean')fail('camera_invalid_response',502);return r.status;
  }
  // Shared streams are never stopped on an individual viewer's exit. WVP/ZLM
  // retains its own no-reader/recording lifecycle; the gateway closes that viewer.
  async ptz(deviceId: string, channelId: string, command: PtzCommand) {
    if (!['left', 'right', 'up', 'down', 'stop'].includes(command)) fail('camera_invalid_command', 422);
    await this.raw(`/api/front-end/ptz/${gbId(deviceId)}/${gbId(channelId)}`, { command, horizonSpeed: '32', verticalSpeed: '32', zoomSpeed: '0' }, true, 800);
  }
  async snapshot(deviceId: string, channelId: string): Promise<Buffer> {
    const result = await this.raw('/api/play/snap', { deviceId: gbId(deviceId), channelId: gbId(channelId) });
    // This pinned WVP returns a filesystem path. Its HTTP reader uses an exact
    // device/channel + mark, not a public /snap static directory.
    const original = typeof result === 'string' ? result : String((result as Json)?.url || '');
    const mark = new RegExp(`^(?:/opt/wvp)?/snap/${deviceId}_${channelId}_(\\d{14})\\.jpg$`).exec(original)?.[1];
    if (!mark) fail('camera_invalid_snapshot', 502);
    const url = new URL(`/api/device/query/snap/${deviceId}/${channelId}`, this.origin); url.searchParams.set('mark', mark);
    let response: Response;
    try { response = await this.transport(url, { headers: { 'access-token': await this.login() }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch { fail('camera_snapshot_failed', 503); }
    if (!response.ok || !response.body) fail('camera_snapshot_failed', 502);
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 4194304) fail('camera_snapshot_too_large', 502); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
}
let singleton: WvpClient | undefined;
export function cameraWvp() {
  if (!singleton) {
    const { CAMERA_WVP_ORIGIN, CAMERA_MEDIA_ORIGIN, CAMERA_WVP_USERNAME, CAMERA_WVP_PASSWORD } = process.env;
    if (!CAMERA_WVP_ORIGIN || !CAMERA_MEDIA_ORIGIN || !CAMERA_WVP_USERNAME || !CAMERA_WVP_PASSWORD) fail('camera_not_configured', 503);
    singleton = new WvpClient({ origin: CAMERA_WVP_ORIGIN, mediaOrigin: CAMERA_MEDIA_ORIGIN, username: CAMERA_WVP_USERNAME, password: CAMERA_WVP_PASSWORD,mediaSecret:process.env.CAMERA_ZLM_SECRET });
  }
  return singleton;
}
