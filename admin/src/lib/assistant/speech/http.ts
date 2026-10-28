import { NextResponse } from 'next/server';
import { fail, key, type ActorContext } from '../contracts';
import { maxSpeechBytes } from './audio';
import { SpeechService, type SpeechTarget } from './service';

export async function speechHttp(request: Request, actor: ActorContext, target: SpeechTarget, path: string[]) {
  const service = new SpeechService(actor, target), json = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'GET' && !path.length) return json(await service.list());
  if (request.method === 'GET' && path.length === 1) {
    const audio = await service.read(path[0]);
    return new Response(new Uint8Array(audio.data), { headers: { 'Content-Type': audio.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method === 'DELETE' && path.length === 1) return json(await service.remove(path[0], key(request.headers.get('Idempotency-Key'))));
  if (request.method !== 'POST') fail('assistant_resource_not_found', 404);
  const chunks: Buffer[] = []; let size = 0;
  if (!request.body) fail('speech_audio_invalid', 422);
  const reader = request.body.getReader();
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > Math.ceil(maxSpeechBytes * 4 / 3) + 2048) { await reader.cancel(); fail('speech_audio_invalid', 413); } chunks.push(Buffer.from(part.value)); } }
  finally { reader.releaseLock(); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('speech_audio_invalid', 422); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('speech_audio_invalid', 422);
  const requestKey = key(request.headers.get('Idempotency-Key'));
  if (!path.length) {
    if (Object.keys(body).some(k => k !== 'data') || typeof body.data !== 'string' || body.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail('speech_audio_invalid', 422);
    return json(await service.upload(requestKey, Buffer.from(body.data, 'base64')));
  }
  if (path.length === 2 && path[1] === 'retry' && Object.keys(body).every(k => k === 'expectedVersion') && Number.isSafeInteger(body.expectedVersion))
    return json(await service.retry(path[0], Number(body.expectedVersion), requestKey));
  fail('assistant_resource_not_found', 404);
}
