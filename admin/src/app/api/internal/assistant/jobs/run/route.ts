import { randomUUID } from 'node:crypto';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { NextResponse } from 'next/server';
import { workerRuntimeSnapshot } from '@/lib/assistant/operations';
import { runAssistantJobsTick } from '@/lib/assistant/infrastructure/jobs-tick';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized' }, { status: 401 });
  const runtime = await workerRuntimeSnapshot();
  return NextResponse.json({ success: true, data: { workerTiming: runtime.timing, retrieval: runtime.retrieval, worker: runtime.heartbeat, authConfigured: runtime.authConfigured, endpointConfigured: runtime.endpointConfigured } });
}
export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized', requestId }, { status: 401 });
  try {
    if ((await request.text()).trim() && (request.headers.get('content-length') !== '0')) {
      return NextResponse.json({ success: false, code: 'invalid_message', requestId }, { status: 422 });
    }
    const data = await runAssistantJobsTick();
    return NextResponse.json({ success: true, data, requestId });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
  }
}
