import type { IncomingMessage } from 'node:http';
import { NextRequest } from 'next/server';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { customerCameraPlayback } from '@/lib/construction/camera/access';
import { cameraError, cameraJson, customerCameraHttp, sessionCameraHttp } from '@/lib/construction/camera/http';
import { ownerSiteCover } from '@/lib/construction/camera/owner-cover';

const miniPath = /^\/api\/miniprogram\/construction\/(?:owner-sites\/([1-9]\d{0,18})\/cover|video\/projects\/([1-9]\d{0,18})\/(cameras|entry))$/;
const sessionPath = /^\/api\/construction-camera\/(exchange|state|live|heartbeat|stop|recordings\/query|playback|ptz|snapshots(?:\/[1-9]\d{0,18})?)$/;

export function debugCameraEntryPath(pathname: string) {
  return process.env.CAMERA_DEBUG_MINI_ROUTES === '1' ? miniPath.exec(pathname) : null;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) fail('camera_invalid_request', 413);
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** The gateway can serve these existing endpoints during a scoped rollout. */
export async function debugCameraGatewayHttp(req: IncomingMessage, url: URL, mini: RegExpExecArray | null) {
  if (process.env.CAMERA_DEBUG_MINI_ROUTES !== '1') return null;
  const method = req.method ?? 'GET';
  const session = sessionPath.exec(url.pathname);
  if (!mini && !session) return null;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  try {
    if (session) {
      if (method !== 'GET' && method !== 'POST') return null;
      const body = method === 'POST' ? await readBody(req) : undefined;
      return await sessionCameraHttp(new Request(url, { method, headers, body }), session[1].split('/'));
    }
    if (!mini || url.search || method !== (mini[3] === 'entry' ? 'POST' : 'GET')) return null;
    const principal = await resolveMiniProgramContext(new NextRequest(url, { headers }));
    if (!principal?.user.openid) return null;
    const token = await verifyMiniProgramToken(headers.get('authorization')!.slice(7));
    if (!token) return null;
    const identity = { userId: principal.user._id, contextVersion: token.contextVersion };
    const projectId = mini[1] ?? mini[2];
    const playback = await customerCameraPlayback(identity, projectId).catch(error => {
      if (error instanceof AssistantError && error.status === 404) return null;
      throw error;
    });
    if (!playback?.debugCamera) return null;
    if (mini[1]) return cameraJson(await ownerSiteCover(identity, projectId));
    const body = method === 'POST' ? await readBody(req) : undefined;
    return await customerCameraHttp(new Request(url, { method, headers, body }), identity, ['projects', projectId, mini[3]]);
  } catch (error) {
    return cameraError(error);
  }
}
