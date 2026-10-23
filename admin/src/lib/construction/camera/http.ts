import { NextResponse } from 'next/server';
import { AssistantError, fail, id } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '../contracts';
import { object } from '../contracts';
import { CameraService, cameraCookie, cameraPublicOrigin, cameraSnapshots, captureCamera, exchangeCameraEntry, sessionHeartbeat, sessionState, startCameraView } from './service';
import { cameraPtz } from './ptz';

export const cameraJson = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
export function cameraError(error: unknown) {
  return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'camera_unavailable' }, {
    status: error instanceof AssistantError ? error.status : 503, headers: { 'Cache-Control': 'no-store' },
  });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []; let size = 0;
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 4096) fail('camera_invalid_request', 413); chunks.push(chunk); }
  try { const r = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error(); return r; }
  catch { fail('camera_invalid_request', 422); }
}
export async function staffCameraHttp(request: Request, actor: ConstructionActor, path: string[]) {
  const service = new CameraService(actor), read = request.method === 'GET';
  if (new URL(request.url).search) fail('camera_invalid_request', 422);
  if (path.join('/') === 'inventory' && read) return cameraJson(await service.inventory());
  if (path.join('/') === 'register' && request.method === 'POST') return cameraJson(await service.register(await body(request)));
  if (path[0] !== 'projects' || path.length !== 3) fail('camera_not_found', 404);
  const pid = id(path[1]);
  if (path[2] === 'inventory' && read) return cameraJson(await service.inventory(pid));
  if (path[2] === 'cameras' && read) return cameraJson(await service.list(pid));
  if (path[2] === 'binding' && request.method === 'POST') return cameraJson(await service.bind(pid, await body(request)));
  if (path[2] === 'configure' && request.method === 'POST') return cameraJson(await service.configure(pid, await body(request)));
  if (path[2] === 'entry' && request.method === 'POST') { object(await body(request), []); return cameraJson(await service.entry(pid)); }
  fail('camera_not_found', 404);
}
export function cookieToken(cookie: string | null) {
  const value = cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(cameraCookie + '='))?.slice(cameraCookie.length + 1);
  if (!value) fail('camera_session_expired', 401);
  return value;
}
export async function sessionCameraHttp(request: Request, path: string[]) {
  try {
    const read = request.method === 'GET', route = path.join('/');
    if (new URL(request.url).search) fail('camera_invalid_request', 422);
    if (!read && (request.method !== 'POST' || request.headers.get('origin') !== cameraPublicOrigin())) fail('camera_origin_forbidden', 403);
    if (route === 'exchange' && request.method === 'POST') {
      const b = object(await body(request), ['entry']); if (typeof b.entry !== 'string') fail('camera_invalid_request', 422);
      const result = await exchangeCameraEntry(b.entry), response = cameraJson({ csrf: result.csrf });
      response.cookies.set(cameraCookie, result.session, { httpOnly: true, secure: cameraPublicOrigin().startsWith('https:'), sameSite: 'strict', path: '/', maxAge: 14400 });
      return response;
    }
    const token = cookieToken(request.headers.get('cookie'));
    if (read && route === 'state') return cameraJson(await sessionState(token));
    if (read && route === 'snapshots') return cameraJson(await cameraSnapshots(token));
    if (read && path[0] === 'snapshots' && path.length === 2) {
      const image = await cameraSnapshots(token, path[1]);
      return new Response(new Uint8Array(image.data as Buffer), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (read) fail('camera_not_found', 404);
    const csrf = request.headers.get('x-camera-csrf'); if (!csrf) fail('camera_session_expired', 401);
    const b = await body(request);
    if (['heartbeat','stop'].includes(route)) { object(b, []); return cameraJson(await sessionHeartbeat(token, csrf, route === 'stop')); }
    if (route === 'live') { object(b, ['bindingId']); return cameraJson(await startCameraView(token, csrf, id(b.bindingId))); }
    if (route === 'snapshots') { object(b, ['bindingId']); return cameraJson(await captureCamera(token, csrf, id(b.bindingId), request.headers.get('idempotency-key') || '')); }
    if (route === 'ptz') { object(b, ['bindingId', 'command', 'sequence']); return cameraJson(await cameraPtz(token, csrf, id(b.bindingId), b.command, b.sequence)); }
    fail('camera_not_found', 404);
  } catch (error) { return cameraError(error); }
}
