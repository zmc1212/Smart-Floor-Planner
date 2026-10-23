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
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  try {
    const url = new URL(req.url || '/', origin);
    if (url.origin !== origin || url.search) { res.writeHead(404).end(); return; }
    if (url.pathname === '/camera-gateway-health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"service":"construction-camera-gateway"}'); return; }
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
    if (!res.headersSent) res.writeHead(error instanceof AssistantError ? error.status : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof AssistantError ? error.code : 'camera_unavailable' }));
  }
});
server.listen(Number(process.env.CAMERA_GATEWAY_PORT || 3017), process.env.CAMERA_BIND_HOST || '127.0.0.1', () => console.log('Construction camera gateway listening'));
async function shutdown() { clearInterval(watchdog); server.closeAllConnections(); server.close(); await closePostgresPool(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
