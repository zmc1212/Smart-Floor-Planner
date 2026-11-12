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

export async function PUT(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  try {
    const { definitionId } = await params;
    const body = await readJsonObject(request);
    if (!Number.isInteger(body.expectedDraftRevision)) {
      throw new WorkflowOperationError('invalid_request', 400, 'expectedDraftRevision must be an integer');
    }
    const record = await getNativeWorkflowService().saveDraft({
      definitionId,
      definition: body.definition,
      expectedDraftRevision: body.expectedDraftRevision as number,
    });
    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    return workflowApiError(error);
  }
}
