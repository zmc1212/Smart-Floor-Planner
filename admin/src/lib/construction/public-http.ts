import { NextResponse } from 'next/server';
import { AssistantError, fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from './contracts';
import { PublicMaterialService } from './public-service';
import { PublicSiteCatalog } from './public-read';
import { PublicCustomerService } from './public-customer';
import type { Row } from '@/db/repositories/assistant-repository';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const publicJson = (data: unknown) => NextResponse.json({ success: true, data }, { headers });
export function publicFailure(error: unknown) { return NextResponse.json({ success: false, code: error instanceof AssistantError ? error.code : 'public_site_unavailable', error: error instanceof AssistantError ? error.code : 'public_site_unavailable' }, { status: error instanceof AssistantError ? error.status : 503, headers }); }
async function body(request: Request): Promise<Row> {
  let size = 0; const chunks: Uint8Array[] = [];
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 64000) fail('invalid_public_material', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { fail('invalid_public_material', 422); }
}
function media(value: { data: Buffer; mimeType: string }) { return new Response(new Uint8Array(value.data), { headers: { ...headers, 'Content-Type': value.mimeType } }); }
export async function staffPublicHttp(request: Request, actor: ConstructionActor, projectId: string, path: string[]) {
  id(projectId); const service = new PublicMaterialService(actor), params = new URL(request.url).searchParams;
  const read = request.method === 'GET';
  if (!path.length && read && !params.size) return publicJson(await service.read(projectId));
  if (read && path[0] === 'source-media' && path.length === 3 && !params.size) return media(await service.media(projectId, id(path[2]), undefined, id(path[1])));
  if (read && path[0] === 'media' && path.length === 2 && [...params.keys()].every(k => k === 'versionId')) return media(await service.media(projectId, id(path[1]), id(params.get('versionId'))));
  if (request.method !== 'POST' || params.size) fail('invalid_public_material', 422);
  const value = await body(request), requestKey = key(request.headers.get('Idempotency-Key'));
  if (!path.length) return publicJson(await service.save(projectId, value, requestKey));
  if (path.length === 1) return publicJson(await service.mutate(projectId, path[0], value, requestKey));
  fail('public_site_unavailable', 404);
}
export async function customerPublicHttp(request: Request, actor: ActorContext, cid: string, path: string[]) {
  const service = new PublicCustomerService(actor, cid), params = new URL(request.url).searchParams;
  if (path.join('/') === 'recommendations' && request.method === 'GET' && !params.size) return publicJson(await service.recommendations());
  if (path.join('/') === 'detach' && request.method === 'POST' && !params.size) {
    if (Object.keys(await body(request)).length) fail('invalid_public_material', 422);
    return publicJson(await service.detach(key(request.headers.get('Idempotency-Key'))));
  }
  const siteId = id(path[0]);
  if (path.length === 1 && request.method === 'GET' && [...params.keys()].every(k => k === 'versionId')) return publicJson(await service.consent(siteId, id(params.get('versionId'))));
  if (path[1] === 'media' && path.length === 3 && request.method === 'GET' && [...params.keys()].every(k => k === 'versionId')) return media(await service.ownerMedia(siteId, id(params.get('versionId')), id(path[2])));
  if (path.length === 2 && request.method === 'POST' && !params.size) {
    const value = await body(request), requestKey = key(request.headers.get('Idempotency-Key'));
    return publicJson(path[1] === 'context' ? await service.context(siteId, value, requestKey) : await service.decide(siteId, path[1], value, requestKey));
  }
  fail('public_site_unavailable', 404);
}
export async function publicCatalogHttp(request: Request, eid: string, path: string[]) {
  try {
    if (request.method !== 'GET') fail('public_site_unavailable', 404);
    const service = new PublicSiteCatalog(id(eid)), params = new URL(request.url).searchParams;
    if (path.join('/') === 'areas' && !params.size) return publicJson(await service.areas());
    if (path.join('/') === 'sites' && [...params.keys()].every(k => ['cityCode','district'].includes(k))) return publicJson(await service.list(params.get('cityCode') || '', params.get('district') || ''));
    if (path[0] === 'sites' && path.length === 2 && [...params.keys()].every(k => k === 'versionId')) return publicJson(await service.detail(id(path[1]), params.has('versionId') ? id(params.get('versionId')) : undefined));
    if (path[0] === 'sites' && path[2] === 'media' && path.length === 4 && [...params.keys()].every(k => k === 'versionId')) return media(await service.media(id(path[1]), id(params.get('versionId')), id(path[3])));
    fail('public_site_unavailable', 404);
  } catch (error) { return publicFailure(error); }
}
