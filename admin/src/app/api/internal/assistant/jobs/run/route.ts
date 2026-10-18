import { randomUUID } from 'node:crypto';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { NextResponse } from 'next/server';
import { processAssistantJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { deliverPublicConsents } from '@/lib/construction/public-projections';
import { workerRuntimeSnapshot } from '@/lib/assistant/operations';
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
    const data = await processAssistantJob(processAssistantRun), inAppDeliveries = await deliverSiteNotifications() + await deliverPublicConsents();
    return NextResponse.json({ success: true, data: { ...data, claimed: data.claimed || inAppDeliveries > 0, inAppDeliveries }, requestId });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
  }
}
