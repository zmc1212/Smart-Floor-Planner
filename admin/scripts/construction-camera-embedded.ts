import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { NextRequest } from 'next/server';
import { POST as login } from '../src/app/api/auth/miniprogram/route';
import { GET as bootstrap } from '../src/app/api/miniprogram/bootstrap/route';
import { GET as identities } from '../src/app/api/miniprogram/identity-contexts/route';
import { POST as switchIdentity } from '../src/app/api/miniprogram/identity-contexts/switch/route';
import { GET as profile } from '../src/app/api/miniprogram/profile/route';
import { GET as mine } from '../src/app/api/miniprogram/mine/route';
import { GET as workbench } from '../src/app/api/miniprogram/workbench/route';
import { GET as notifications } from '../src/app/api/miniprogram/notifications/route';
import { GET as constructionGet, POST as constructionPost } from '../src/app/api/miniprogram/construction/[[...path]]/route';
import { GET as playerPage } from '../src/app/construction-camera/route';
import { sessionCameraHttp } from '../src/lib/construction/camera/http';
import { publicCatalogHttp } from '../src/lib/construction/public-http';
import { resolveMiniProgramContext } from '../src/lib/miniprogram-auth';
import { fail } from '../src/lib/assistant/contracts';

/** Explicit trial listener. All identity, tenant and camera checks remain in their
 * canonical route handlers; this is not an alternate general Admin/API server. */
export async function embeddedCameraHttp(req: IncomingMessage, url: URL): Promise<Response | null> {
  if (process.env.CAMERA_EMBEDDED_TRIAL !== '1') return null;
  if (process.env.CAMERA_TRIAL_ENTERPRISE_ID !== '1454') throw Error('Explicit Weiyun trial scope required');
  const method = req.method || 'GET', p = url.pathname;
  const getRoutes: Record<string, (request: NextRequest) => Promise<Response>> = {
    '/api/miniprogram/bootstrap': bootstrap,
    '/api/miniprogram/identity-contexts': identities,
    '/api/miniprogram/profile': profile,
    '/api/miniprogram/mine': mine,
    '/api/miniprogram/workbench': workbench,
    '/api/miniprogram/notifications': notifications,
  };
  const mini = /^\/api\/miniprogram\/construction\/(video\/[^?]+|projects(?:\/[1-9]\d*)?)$/.exec(p);
  const session = /^\/api\/construction-camera\/([^?]+)$/.exec(p);
  const staticFile = /^\/construction-camera\/(player\.js|style\.css|vendor\/[a-zA-Z0-9_.-]+|assets\/(?:(?:camera|image|move|up|down|left|right)\.png|site-serif\.woff2))$/.exec(p);
  const notebook = process.env.CAMERA_TRIAL_NOTEBOOK === '1';
  const notebookRead = notebook && /^\/api\/miniprogram\/construction\/(brief|projects\/12\/chat(?:\/media\/[1-9]\d{0,18})?)$/.exec(p);
  const publicRead = notebook && /^\/api\/miniprogram\/construction\/public-catalogue\/1454\/(areas|sites(?:\/[1-9]\d{0,18}(?:\/media\/[1-9]\d{0,18})?)?)$/.exec(p);
  const allowed = p === '/construction-camera' || staticFile || session || mini || notebookRead || publicRead || getRoutes[p]
    || p === '/api/auth/miniprogram' || p === '/api/miniprogram/identity-contexts/switch';
  if (!allowed) return null;
  if (!['GET', 'POST'].includes(method)) return new Response(null, { status: 405 });
  if ((notebookRead || publicRead) && method !== 'GET') return new Response(null, { status: 405 });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const chunks: Buffer[] = []; let bytes = 0;
  if (method === 'POST') for await (const chunk of req) {
    bytes += chunk.length; if (bytes > 32768) fail('camera_invalid_request', 413); chunks.push(Buffer.from(chunk));
  }
  const request = new NextRequest(url, { method, headers, body: method === 'POST' ? Buffer.concat(chunks) : undefined });
  if (p === '/construction-camera' && method === 'GET') return playerPage();
  if (staticFile && method === 'GET') {
    const types: Record<string, string> = {
      '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2',
    };
    const file = staticFile[1], type = types[path.extname(file)] || 'application/javascript; charset=utf-8';
    try { return new Response(new Uint8Array(await fs.readFile(path.join(process.cwd(), 'public/construction-camera', file))), { headers: { 'Content-Type': type } }); }
    catch { return new Response(null, { status: 404 }); }
  }
  if (session) return sessionCameraHttp(request, session[1].split('/'));
  if (p === '/api/auth/miniprogram' && method === 'POST') {
    const input = await request.clone().json().catch(() => null);
    if (!input || !['password', 'refresh'].includes(input.type)) fail('camera_trial_password_login_required', 403);
    return login(request);
  }
  // Trial data contains only retained synthetic Weiyun employees. This extra
  // deployment fence cannot grant anything denied by the shared resolver.
  const identity = await resolveMiniProgramContext(request);
  if (!identity) fail('Unauthorized', 401);
  if (identity.enterpriseId !== '1454' || identity.mode !== 'staff') fail('construction_forbidden', 403);
  if (getRoutes[p] && method === 'GET') return getRoutes[p](request);
  if (notebookRead) return constructionGet(request, { params: Promise.resolve({ path: notebookRead[1].split('/') }) });
  if (publicRead) return publicCatalogHttp(request, '1454', publicRead[1].split('/'));
  if (p === '/api/miniprogram/identity-contexts/switch' && method === 'POST') return switchIdentity(request);
  if (mini) {
    if (mini[1].startsWith('projects') && method !== 'GET') return new Response(null, { status: 405 });
    return (method === 'GET' ? constructionGet : constructionPost)(request, { params: Promise.resolve({ path: mini[1].split('/') }) });
  }
  return new Response(null, { status: 405 });
}
