import { NextResponse } from 'next/server';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { tickWechatChannel } from '@/lib/assistant/wechat/worker';
import { resolveWorkerDeployment } from '@/lib/xiaok-v1/worker-runtime-config';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false }, { status: 401 });
  try {
    const { gate } = await resolveWorkerDeployment();
    const active = gate.status === 'open' && !!gate.enterpriseId && await tickWechatChannel(gate.enterpriseId);
    return NextResponse.json({ success: true, active });
  } catch {
    return NextResponse.json({ success: false }, { status: 503 });
  }
}
