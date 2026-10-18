import { NextResponse } from 'next/server';
import { fail, key, type ActorContext } from '@/lib/assistant/contracts';
import { PlanCustomerService } from './site-plans';

export async function customerPlanHttp(request: Request, actor: ActorContext, cid: string, path: string[]) {
  const service = new PlanCustomerService(actor, cid);
  if (new URL(request.url).searchParams.size) fail('invalid_plan', 422);
  if (request.method === 'GET' && path.length === 1) return NextResponse.json({ success: true, data: await service.read(path[0]) }, { headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'GET' && path.length === 2 && path[1] === 'media') {
    const media = await service.media(path[0]);
    return new Response(new Uint8Array(media.data), { headers: { 'Content-Type': media.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method !== 'POST' || path.length !== 2) fail('plan_unavailable', 404);
  const chunks: Uint8Array[] = []; let bytes = 0;
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { bytes += chunk.length; if (bytes > 8000) fail('invalid_plan', 413); chunks.push(chunk); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_plan', 422); }
  return NextResponse.json({ success: true, data: await service.decide(path[0], path[1], body, key(request.headers.get('Idempotency-Key'))) }, { headers: { 'Cache-Control': 'no-store' } });
}
