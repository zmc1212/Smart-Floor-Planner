import { NextResponse } from 'next/server';
import { fail, id, key } from '@/lib/assistant/contracts';
import { SiteChatService } from './site-chat';
import type { ConstructionActor } from './contracts';

async function limitedBytes(request: Request, max: number) {
  let size = 0; const chunks: Uint8Array[] = [];
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length; if (size > max) fail('invalid_construction', 413); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function siteChatHttp(request: Request, actor: ConstructionActor, projectId: string, path: string[]) {
  id(projectId);
  const service = new SiteChatService(actor), params = new URL(request.url).searchParams;
  if ([...params.keys()].some(k => !(!path.length && request.method === 'GET' && ['beforeSeq', 'limit'].includes(k)))) fail('invalid_construction', 422);
  const json = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  if (!path.length && request.method === 'GET') return json(await service.read(projectId, params.has('beforeSeq') ? id(params.get('beforeSeq')) : undefined, params.has('limit') ? Number(params.get('limit')) : 30));
  if (path[0] === 'operations' && path.length === 2 && request.method === 'GET') return json(await service.operation(projectId, path[1]));
  if (path[0] === 'media' && path.length === 2 && request.method === 'GET') {
    const media = await service.media(projectId, id(path[1]));
    return new Response(new Uint8Array(media.data), { headers: { 'Content-Type': media.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path[0] === 'materials' && path[2] === 'media' && path.length === 4 && request.method === 'GET') {
    const media = await service.materialMedia(projectId, id(path[1]), id(path[3]));
    return new Response(new Uint8Array(media.data), { headers: { 'Content-Type': media.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (path[0] === 'records' && path[2] === 'versions' && path.length === 3 && request.method === 'GET') return json(await service.versions(projectId, id(path[1])));
  if (request.method !== 'POST') fail('construction_not_found', 404);
  const requestKey = key(request.headers.get('Idempotency-Key'));
  await service.authorize(projectId, true);
  if (path.join('/') === 'media') {
    const bytes = await limitedBytes(request, 4 * 1024 * 1024 + 65536);
    let form: FormData;
    try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type') || '' }, body: bytes }).formData(); }
    catch { fail('media_invalid', 422); }
    if ([...form.keys()].some(k => k !== 'file') || form.getAll('file').length !== 1) fail('media_invalid', 422);
    const file = form.get('file');
    if (!file || typeof file === 'string' || file.size > 4 * 1024 * 1024) fail('media_invalid', 422);
    return json(await service.upload(projectId, requestKey, Buffer.from(await file.arrayBuffer())));
  }
  let body;
  const raw = await limitedBytes(request, 20000);
  try { body = JSON.parse(raw.toString('utf8')); } catch { fail('invalid_construction', 422); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_construction', 422);
  if (path[0] === 'media' && path[2] === 'remove' && path.length === 3) {
    if (Object.keys(body).length) fail('invalid_construction', 422);
    return json(await service.removeMedia(projectId, id(path[1]), requestKey));
  }
  if (path.join('/') === 'messages') return json(await service.send(projectId, body, requestKey));
  if (path[0] === 'records' && path.length === 3) return json(await service.mutate(projectId, id(path[1]), path[2], body, requestKey));
  fail('construction_not_found', 404);
}
