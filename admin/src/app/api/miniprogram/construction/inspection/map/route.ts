import { NextResponse } from 'next/server';
import { AssistantError, fail, fingerprint } from '@/lib/assistant/contracts';
import { inspectionStops } from '@/lib/construction/inspection';
import { inspectionBrowserKey, verifyInspectionMapSession } from '@/lib/construction/inspection-map-session';
import { planInspectionRoute } from '@/lib/construction/inspection-route';
import { runInspectionRoute } from '@/lib/construction/inspection-route-run';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const errorResponse = (error: unknown) => NextResponse.json({
  success: false, error: error instanceof AssistantError ? error.code : 'construction_unavailable',
}, { headers, status: error instanceof AssistantError ? error.status : 503 });

export async function GET(request: Request) {
  try {
    const { actor, origin } = await verifyInspectionMapSession(request);
    const stops = await inspectionStops(actor);
    return NextResponse.json({ success: true, data: { stops, origin, browserKey: inspectionBrowserKey() } }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { actor } = await verifyInspectionMapSession(request);
    let raw = '', bytes = 0;
    if (request.body) for await (const data of request.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += data.byteLength;
      if (bytes > 4096) fail('invalid_construction', 413);
      raw += Buffer.from(data).toString('utf8');
    }
    let input;
    try { input = JSON.parse(raw); } catch { fail('invalid_construction', 422); }
    const requestId = request.headers.get('x-inspection-request-id');
    if (requestId !== null) {
      if (!/^[a-f0-9]{32}$/.test(requestId)) fail('invalid_construction', 422);
      const requestKey = fingerprint({ requestId, session: request.headers.get('authorization') });
      const data = await runInspectionRoute(actor, input, requestKey);
      return NextResponse.json({ success: true, data }, { headers, status: data ? 200 : 202 });
    }
    return NextResponse.json({ success: true, data: await planInspectionRoute(actor, input) }, { headers });
  } catch (error) { return errorResponse(error); }
}
