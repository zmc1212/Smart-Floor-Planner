import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { runWorkflowReminderScan } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

async function authorize(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get('x-cron-secret');

  if (cronSecret && headerSecret === cronSecret) {
    return true;
  }

  const context = await getTenantContext(request);
  return !!context && ['super_admin', 'admin'].includes(context.role);
}

async function handleRun(request: Request) {
  await dbConnect();

  const allowed = await authorize(request);
  if (!allowed) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runWorkflowReminderScan();
  return NextResponse.json({ success: true, data: result });
}

export async function GET(request: Request) {
  try {
    return await handleRun(request);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await handleRun(request);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
