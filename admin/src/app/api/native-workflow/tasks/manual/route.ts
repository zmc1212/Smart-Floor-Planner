import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/auth';
import { readNativeToolManualQueue } from '@/lib/native-workflow/live/durable-tool-worker';
import { requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  const context = await getTenantContext(request);
  if (!context?.enterpriseId) {
    return NextResponse.json({ success: false, error: 'enterprise_context_required' }, { status: 409 });
  }
  try {
    const tasks = await readNativeToolManualQueue(context.enterpriseId);
    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    return workflowApiError(error);
  }
}
