import { NextResponse } from 'next/server';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import {
  getNativeWorkflowService,
  readJsonObject,
  requirePlatformAdmin,
  workflowApiError,
} from '@/lib/native-workflow/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  try {
    const { definitionId } = await params;
    const body = await readJsonObject(request);
    if (!Number.isInteger(body.expectedDraftRevision)) {
      throw new WorkflowOperationError('invalid_request', 400, 'expectedDraftRevision must be an integer');
    }
    const result = await getNativeWorkflowService().publishDraft({
      definitionId,
      expectedDraftRevision: body.expectedDraftRevision as number,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return workflowApiError(error);
  }
}
