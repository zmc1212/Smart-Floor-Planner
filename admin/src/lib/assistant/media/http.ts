import { NextResponse } from 'next/server';
import { fail, key, type ActorContext } from '../contracts';
import { AssistantMediaService, MAX_MEDIA_BYTES } from './service';

export async function mediaHttp(request: Request, actor: ActorContext, conversationId: string, path: string[]) {
  const service = new AssistantMediaService(actor);
  if (path.length === 1 && path[0] === 'floorplans') {
    let data;
    if (request.method === 'GET') data = await service.floorPlans(conversationId);
    else if (request.method === 'POST') {
      const text = await request.text(); if (text.length > 2048) fail('invalid_message', 422);
      let body; try { body = JSON.parse(text); } catch { fail('invalid_message', 422); }
      if (!body || Array.isArray(body) || typeof body !== 'object') fail('invalid_message', 422);
      data = await service.attachFormal(conversationId, key(request.headers.get('Idempotency-Key')), body);
    } else fail('assistant_resource_not_found', 404);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method === 'GET' && path.length === 1) {
    const image = await service.read(conversationId, path[0]);
    return new Response(new Uint8Array(image.data), { headers: { 'Content-Type': image.mime,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="consultation.jpg"' } });
  }
  let data: unknown;
  if (request.method === 'GET' && !path.length) data = await service.list(conversationId);
  else if (request.method === 'DELETE' && path.length === 1) data = await service.remove(conversationId, path[0]);
  else if (request.method === 'POST' && !path.length) {
    // Bound streaming input even when Content-Length is absent/untrusted.
    const reader = request.body?.getReader();
    if (!reader) fail('media_invalid', 422);
    const parts: Buffer[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 2048) { await reader.cancel(); fail('media_invalid', 422); }
        parts.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let body;
    try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('media_invalid', 422); }
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !['data', 'kind', 'roomName'].includes(k)) ||
      typeof body.data !== 'string' || body.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail('media_invalid', 422);
    data = await service.upload(conversationId, key(request.headers.get('Idempotency-Key')), Buffer.from(body.data, 'base64'), body.kind, body.roomName ?? '');
  } else fail('assistant_resource_not_found', 404);
  return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
