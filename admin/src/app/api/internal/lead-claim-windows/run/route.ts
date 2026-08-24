import { NextResponse } from 'next/server';
import { getLeadClaimWorkerHealth, processExpiredLeadClaimWindows } from '@/lib/lead-claim-worker';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('x-cron-secret') === secret);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true, data: getLeadClaimWorkerHealth() });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await processExpiredLeadClaimWindows(200);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '派单扫描失败' }, { status: 500 });
  }
}
