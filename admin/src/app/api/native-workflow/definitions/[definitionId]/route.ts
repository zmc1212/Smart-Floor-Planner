import { NextResponse } from 'next/server';
import {
  getNativeWorkflowService,
  requirePlatformAdmin,
  workflowApiError,
} from '@/lib/native-workflow/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  try {
    const { definitionId } = await params;
    const detail = await getNativeWorkflowService().getDefinition(definitionId);
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    return workflowApiError(error);
  }
}
