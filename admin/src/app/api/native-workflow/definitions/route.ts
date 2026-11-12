import { NextResponse } from 'next/server';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import {
  getNativeWorkflowService,
  readJsonObject,
  requirePlatformAdmin,
  workflowApiError,
} from '@/lib/native-workflow/server';
import { isNativeWorkflowTemplateId } from '@/lib/native-workflow/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ success: true, data: await getNativeWorkflowService().listDefinitions() });
  } catch (error) {
    return workflowApiError(error);
  }
}

export async function POST(request: Request) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  try {
    const body = await readJsonObject(request);
    if (!isNativeWorkflowTemplateId(body.templateId)) {
      throw new WorkflowOperationError('invalid_request', 400, 'templateId must be a known template');
    }
    const record = await getNativeWorkflowService().createFromTemplate(body.templateId);
    return NextResponse.json({ success: true, data: record }, { status: 201 });
  } catch (error) {
    return workflowApiError(error);
  }
}
