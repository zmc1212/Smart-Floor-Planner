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
    const source = body.source ?? 'draft';
    if (source !== 'draft' && source !== 'published') {
      throw new WorkflowOperationError('invalid_request', 400, 'source must be draft or published');
    }
    if (typeof body.fixtureSetId !== 'string' || body.fixtureSetId === '') {
      throw new WorkflowOperationError('invalid_request', 400, 'fixtureSetId is required');
    }
    const revision = body.revision === undefined ? undefined : Number(body.revision);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) {
      throw new WorkflowOperationError('invalid_request', 400, 'revision must be a positive integer');
    }
    const result = await getNativeWorkflowService().simulate({
      definitionId,
      source,
      revision,
      fixtureSetId: body.fixtureSetId,
    });
    return NextResponse.json({
      success: true,
      data: { source: result.source, revision: result.revision, simulation: result.simulation },
    });
  } catch (error) {
    return workflowApiError(error);
  }
}
