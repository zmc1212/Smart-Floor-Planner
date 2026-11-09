import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '../src/db/transaction';
import { closePostgresPool } from '../src/lib/postgresql';
import { AssistantError } from '../src/lib/assistant/contracts';
import { cookieToken } from '../src/lib/construction/camera/http';
import { authorizeCameraMedia, cameraPublicOrigin, digest } from '../src/lib/construction/camera/service';
import { cameraMediaPath, rewriteCameraPlaylist } from '../src/lib/construction/camera/media';
import { cameraWatchdog } from '../src/lib/construction/camera/ptz';
import { cameraWvp } from '../src/lib/construction/camera/wvp';
import {authorizeRecordingMedia,reconcileRecordings,purgeCameraRecordings} from '../src/lib/construction/camera/recordings';
import {refreshSdWindows,reconcileSdPlaybacks} from '../src/lib/construction/camera/sd';
import {purgeCameraSnapshots} from '../src/lib/construction/camera/snapshot-retention';
import {startStorageHealthSampler} from '../src/lib/construction/camera/storage';
import {embeddedCameraHttp} from './construction-camera-embedded';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const origin = cameraPublicOrigin();
const appOrigin = new URL(process.env.CAMERA_APP_ORIGIN || 'http://127.0.0.1:3006');
if (!['http:', 'https:'].includes(appOrigin.protocol) || appOrigin.username || appOrigin.password) throw Error('Invalid app origin');
let watchdogBusy = false, tick = 0;
// ZLM requires its HLS cookie on segment requests. Keep it private and scoped to
// the authenticated viewer/generation; never forward the browser's cookies.
const hlsCookies = new Map<string, { value: string; expires: number }>();
const watchdog = setInterval(async () => {
  if (watchdogBusy) return; watchdogBusy = true;
  try {
    await cameraWatchdog();
    for (const [key, value] of hlsCookies) if (value.expires < Date.now()) hlsCookies.delete(key);
    if (++tick % 120 === 0) await withPlatformTransaction(async tx => {
      await tx.execute(sql`delete from app.construction_camera_entries where expires_at<now()-interval '1 hour'`);
      await tx.execute(sql`delete from app.construction_camera_sessions where expires_at<now()-interval '1 day'`);
      await tx.execute(sql`update app.construction_camera_snapshots set state='failed' where state='pending' and created_at<now()-interval '2 minutes'`);
    });
  } catch { console.error('Camera watchdog unavailable; persistent obligations retained'); }
  finally { watchdogBusy = false; }
}, 500);
// Provider reconciliation must never delay the short PTZ STOP watchdog.
let recorderBusy=false,lastPurge=0,sdBusy=false,sdClockBusy=false,snapshotBusy=false;
const stopStorageSampler=startStorageHealthSampler(undefined,()=>console.error('Camera storage sampling unavailable; recording remains protected'));
// Database-only byte cleanup stays independent of WVP/storage outages and PTZ.
const snapshots=setInterval(async()=>{
  if(snapshotBusy)return;snapshotBusy=true;
  try{await purgeCameraSnapshots();}
  catch{console.error('Camera snapshot cleanup unavailable; private expiry remains enforced');}
  finally{snapshotBusy=false;}
},60000);
const sdWatcher=setInterval(async()=>{
  if(sdBusy)return;sdBusy=true;
  try{await reconcileSdPlaybacks();}
  catch{console.error('SD playback cleanup unavailable; durable ownership retained');}
  finally{sdBusy=false;}
},5000);
const sdClockWatcher=setInterval(async()=>{
  if(sdClockBusy)return;sdClockBusy=true;
  try{await refreshSdWindows();}
  catch{console.error('SD clock sampling unavailable; unverified intervals remain unavailable');}
  finally{sdClockBusy=false;}
},30000);
const recorder=setInterval(async()=>{
  if(recorderBusy)return;recorderBusy=true;
  try{await reconcileRecordings();if(Date.now()-lastPurge>600000){await purgeCameraRecordings();lastPurge=Date.now();}}
  catch{console.error('Camera recorder unavailable; durable policies and deletion claims retained');}
  finally{recorderBusy=false;}
},5000);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  try {
    const url = new URL(req.url || '/', origin);
    if (url.origin !== origin) { res.writeHead(404).end(); return; }
    if(process.env.CAMERA_EMBEDDED_TRIAL==='1'){
      const response=await embeddedCameraHttp(req,url);
      if(response){
        for(const [key,value] of response.headers)res.setHeader(key,value);
        const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
        res.writeHead(response.status);
        if(response.body)await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),res);else res.end();
        return;
      }
    }
    if(url.search){res.writeHead(404).end();return;}
    if (url.pathname === '/camera-gateway-health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"service":"construction-camera-gateway"}'); return; }
    const recording=/^\/camera-recording\/([1-9]\d*)\/([1-9]\d{0,18})\.mp4$/.exec(url.pathname);
    if(recording){
      if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405).end();return;}
      if(req.headers.range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)){res.writeHead(416).end();return;}
      const token=cookieToken(req.headers.cookie||null),generation=Number(recording[1]),rid=recording[2];
      const record=await authorizeRecordingMedia(token,generation,rid),abort=new AbortController();
      const disconnect=()=>abort.abort();res.once('close',disconnect);let validating=false;
      const interval=setInterval(async()=>{if(validating)return;validating=true;try{await authorizeRecordingMedia(token,generation,rid);}catch{abort.abort();res.destroy();}finally{validating=false;}},5000);
      const timer=setTimeout(disconnect,15000);
      try{
        const response=await fetch(cameraWvp().recordingUrl(record.filePath),{method:req.method,redirect:'error',signal:abort.signal,headers:req.headers.range?{Range:req.headers.range}:{}});clearTimeout(timer);
        if(!response.ok&&response.status!==206){res.writeHead([404,410,416].includes(response.status)?response.status:502).end();await response.body?.cancel();return;}
        if(/json|text\//i.test(response.headers.get('content-type')||'')){res.writeHead(502).end();await response.body?.cancel();return;}
        res.setHeader('Content-Type','video/mp4');
        for(const name of ['content-length','content-range','accept-ranges']){const value=response.headers.get(name);if(value)res.setHeader(name,value);}
        res.writeHead(response.status);
        if(response.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),res);else res.end();
      }finally{clearInterval(interval);clearTimeout(timer);abort.abort();res.off('close',disconnect);}
      return;
    }
    const media = /^\/camera-media\/([1-9]\d*)\/(.+)$/.exec(url.pathname);
    if (media) {
      if (!['GET','HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return; }
      const token = cookieToken(req.headers.cookie || null), generation = Number(media[1]);
      const stream = await authorizeCameraMedia(token, generation);
      const source = new URL(cameraMediaPath(stream, media[2]), cameraWvp().mediaOrigin);
      const cookieKey = digest(token) + ':' + generation;
      const headers: Record<string,string> = {};
      if (req.headers.range) headers.Range = req.headers.range;
      const sourceCookie = hlsCookies.get(cookieKey); if (sourceCookie && sourceCookie.expires > Date.now()) headers.Cookie = sourceCookie.value;
      const abort = new AbortController(); let validating = false;
      const disconnect = () => abort.abort(); res.once('close', disconnect);
      const interval = setInterval(async () => {
        if (validating) return; validating = true;
        try { await authorizeCameraMedia(token, generation); } catch { abort.abort(); res.destroy(); }
        finally { validating = false; }
      }, 5000);
      const firstByteTimeout = setTimeout(disconnect, 15000);
      try {
        const upstream = await fetch(source, { method: req.method, redirect: 'error', signal: abort.signal, headers });
        clearTimeout(firstByteTimeout);
        if (!upstream.ok && upstream.status !== 206) { res.writeHead(502).end(); await upstream.body?.cancel(); return; }
        if (media[2].endsWith('.m3u8') && req.method !== 'HEAD') {
          const cookies = upstream.headers.getSetCookie().map(value=>value.split(';')[0]).filter(value=>/^[A-Za-z0-9_-]+=[^\r\n;]{1,2048}$/.test(value));
          if (cookies.length) {
            if (hlsCookies.size >= 5000 && !hlsCookies.has(cookieKey)) hlsCookies.delete(hlsCookies.keys().next().value!);
            hlsCookies.set(cookieKey,{value:cookies.join('; '),expires:Date.now()+120000});
          }
          const text = rewriteCameraPlaylist(await upstream.text(), source, stream, generation);
          res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end(text); return;
        }
        for (const h of ['content-type','content-length','content-range','accept-ranges']) { const value = upstream.headers.get(h); if (value) res.setHeader(h, value); }
        res.writeHead(upstream.status);
        if (upstream.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res);
        else res.end();
      } finally { clearInterval(interval); clearTimeout(firstByteTimeout); abort.abort(); res.off('close', disconnect); }
      return;
    }
    // Embedded trials expose only the handlers above and authenticated media.
    if(process.env.CAMERA_EMBEDDED_TRIAL==='1'){res.writeHead(404).end();return;}
    // H5 assets/API only. This listener is not an alternate Admin entry point.
    if (!(/^\/construction-camera(?:\/|$)/.test(url.pathname) || /^\/api\/construction-camera(?:\/|$)/.test(url.pathname) || url.pathname.startsWith('/_next/'))) { res.writeHead(404).end(); return; }
    const upstreamUrl = new URL(url.pathname, appOrigin);
    const transport = upstreamUrl.protocol === 'https:' ? https : http;
    const proxy = transport.request(upstreamUrl, { method: req.method, headers: { ...req.headers, host: appOrigin.host } }, upstream => {
      res.writeHead(upstream.statusCode || 502, { ...upstream.headers, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); upstream.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => proxy.destroy()); req.pipe(proxy);
  } catch (error) {
    if(res.headersSent){res.destroy();return;}
    if (!res.headersSent) res.writeHead(error instanceof AssistantError ? error.status : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof AssistantError ? error.code : 'camera_unavailable' }));
  }
});
server.listen(Number(process.env.CAMERA_GATEWAY_PORT || 3017), process.env.CAMERA_BIND_HOST || '127.0.0.1', () => console.log('Construction camera gateway listening'));
async function shutdown() { clearInterval(watchdog);clearInterval(recorder);clearInterval(sdWatcher);clearInterval(sdClockWatcher);clearInterval(snapshots); server.closeAllConnections(); server.close(); await stopStorageSampler(); await closePostgresPool(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
