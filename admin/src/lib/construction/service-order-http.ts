import { NextResponse } from 'next/server';
import { fail, id, key } from '@/lib/assistant/contracts';
import type { Row } from '@/db/repositories/assistant-repository';
import type { ConstructionActor } from './contracts';
import { ServiceOrderService } from './service-order';

const headers = { 'Cache-Control': 'no-store' };
const json = (data: unknown) => NextResponse.json({ success: true, data }, { headers });
function pathId(value: unknown) {
  try { return id(value); } catch { fail('service_order_not_found', 404); }
}
function requestKeyHeader(value: string | null) {
  try { return key(value); } catch { fail('invalid_service_order', 422); }
}
async function body(request: Request): Promise<Row> {
  let size = 0; const chunks: Uint8Array[] = [];
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length; if (size > 32000) fail('invalid_service_order', 413); chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { fail('invalid_service_order', 422); }
}
export async function serviceOrderHttp(request: Request, actor: ConstructionActor, projectId: string, path: string[]) {
  pathId(projectId);
  const service = new ServiceOrderService(actor), params = new URL(request.url).searchParams;
  if (request.method === 'GET' && !path.length && !params.size) return json(await service.list(projectId));
  if (request.method !== 'POST' || params.size) fail('service_order_not_found', 404);
  const input = await body(request), requestKey = requestKeyHeader(request.headers.get('Idempotency-Key'));
  if (!path.length) return json(await service.create(projectId, input, requestKey));
  const orderId = pathId(path[0]);
  if (path.length === 2 && path[1] === 'quote') return json(await service.quote(projectId, orderId, input, requestKey));
  if (path.length === 2 && path[1] === 'confirm') return json(await service.confirm(projectId, orderId, input, requestKey));
  if (path.length === 2 && path[1] === 'schedule') return json(await service.schedule(projectId, orderId, input, requestKey));
  if (path.length === 2 && path[1] === 'cancel') return json(await service.cancel(projectId, orderId, input, requestKey));
  if (path.length === 3 && path[1] === 'points') return json(await service.point(projectId, orderId, pathId(path[2]), input, requestKey));
  fail('service_order_not_found', 404);
}
