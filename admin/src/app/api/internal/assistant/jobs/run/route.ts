import { randomUUID } from 'node:crypto';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { NextResponse } from 'next/server';
import { processAssistantJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAssistantRun } from '@/lib/assistant/application/worker';
import { deliverSiteNotifications } from '@/lib/construction/site-publications';
import { deliverPublicConsents } from '@/lib/construction/public-projections';
import { workerRuntimeSnapshot } from '@/lib/assistant/operations';
import { advanceKnowledgeBatches } from '@/lib/assistant/knowledge/batch-worker';
import { processPortfolioCopy } from '@/lib/portfolio/copy-service';
import { advanceConstructionReports, deliverConstructionReports } from '@/lib/construction/report-worker';
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
    const knowledgeBatchChecks=await advanceKnowledgeBatches();
    const constructionReportChecks = await advanceConstructionReports();
    const data = await processAssistantJob(processAssistantRun), inAppDeliveries = await deliverSiteNotifications() + await deliverPublicConsents() + await deliverConstructionReports();
    const portfolioCopyClaimed = data.claimed ? false : await processPortfolioCopy();
    return NextResponse.json({ success: true, data: { ...data, claimed: data.claimed || portfolioCopyClaimed || inAppDeliveries > 0, portfolioCopyClaimed, inAppDeliveries, knowledgeBatchChecks, constructionReportChecks }, requestId });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
  }
}
