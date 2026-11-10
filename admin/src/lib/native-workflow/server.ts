import { NextResponse } from 'next/server';
import { authorizePlatformAdmin } from '@/lib/auth';
import { WorkflowDefinitionError, WorkflowOperationError } from './errors';
import { createWorkflowService, type WorkflowService } from './service';
import { createFileWorkflowStore, resolveNativeWorkflowStoreDir } from './store/file-store';

let cachedService: WorkflowService | null = null;

/** Server-only composition: B-owned file store behind the store interface. */
export function getNativeWorkflowService(): WorkflowService {
  if (!cachedService) {
    cachedService = createWorkflowService({
      store: createFileWorkflowStore({ rootDir: resolveNativeWorkflowStoreDir() }),
    });
  }
  return cachedService;
}

export function workflowApiError(error: unknown): NextResponse {
  if (error instanceof WorkflowOperationError) {
    return NextResponse.json(
      { success: false, error: error.code, message: error.message, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof WorkflowDefinitionError) {
    return NextResponse.json(
      { success: false, error: 'workflow_definition_invalid', issues: error.issues },
      { status: 422 },
    );
  }
  return NextResponse.json({ success: false, error: 'native_workflow_error' }, { status: 500 });
}

export async function requirePlatformAdmin(request: Request): Promise<NextResponse | null> {
  return authorizePlatformAdmin(request);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new WorkflowOperationError('invalid_request', 400, 'request body must be JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowOperationError('invalid_request', 400, 'request body must be an object');
  }
  return raw as Record<string, unknown>;
}
