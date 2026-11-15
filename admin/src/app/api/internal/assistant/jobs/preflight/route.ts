import { NextResponse } from 'next/server';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { assistantWorkerPreflight } from '@/lib/assistant/infrastructure/worker-preflight';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Read-only Worker startup preflight. The response contains the deployment
 * safety gate, a redacted mode summary, the saved pilot scope when applicable
 * and a dry-run queue preview. It never claims, retries or writes. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized' }, { status: 401 });
  try {
    const data = await assistantWorkerPreflight();
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ success: false, code: 'assistant_preflight_unavailable' }, { status: 503 });
  }
}
