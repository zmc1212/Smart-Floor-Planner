import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantError } from '@/lib/assistant/contracts';
import { getTenantContext } from '@/lib/auth';
import { readProjectAccess } from '@/lib/native-workflow/live/project-access';
import { createPostgresWorkflowRunStore } from '@/lib/native-workflow/live/runtime-postgres-stores';
import type { LiveRunRecord } from '@/lib/native-workflow/live/types';
import { requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function debugView(record: LiveRunRecord) {
  return {
    binding: { runId: record.binding.runId, definitionId: record.binding.definitionId,
      revision: record.binding.revision, digest: record.binding.digest },
    status: record.status, currentNodeId: record.state.pendingNodeId ?? record.state.currentNodeId,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    error: record.state.error ? { code: record.state.error.code, path: record.state.error.path } : null,
    operations: record.operations.map(operation => ({
      nodeId: operation.nodeId, capability: operation.capabilityRef, version: operation.nodeVersion, status: operation.outcome,
      durationMs: Date.parse(operation.finishedAt) - Date.parse(operation.startedAt),
      outputPorts: Object.keys(operation.outputs ?? {}),
      ...(operation.error ? { error: operation.error.code } : {}),
      // Only the public technical locators and usage are needed for debugging.
      // No message content, knowledge text, private records or model packets.
      ...(operation.capabilityRef === 'compose.stage_specialist' ? { analysis: operation.outputs?.analysis } : {}),
      ...(operation.capabilityRef === 'read.specialist_public_standard' ? { publicStandard: operation.outputs?.publicStandard } : {}),
    })),
    trace: record.trace.map(entry => ({ seq: entry.seq, at: entry.at, kind: entry.kind, nodeId: entry.nodeId,
      ...(['node_waiting', 'run_resumed', 'branch_selected'].includes(entry.kind) ? { detail: entry.detail } : {}) })),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const denied = await requirePlatformAdmin(request);
  if (denied) return denied;
  const context = await getTenantContext(request);
  if (!context?.enterpriseId) {
    return NextResponse.json({ success: false, error: 'enterprise_context_required' }, { status: 409 });
  }
  const enterpriseId = context.enterpriseId;
  try {
    const { runId } = await params;
    if (!/^specialist:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId)) throw new WorkflowOperationError('run_not_found', 404, '未找到防水运行');
    const data = await withTenantTransaction(enterpriseId, async tx => {
      const record = await createPostgresWorkflowRunStore(enterpriseId, tx).get(runId);
      if (!record || record.binding.event.eventType !== 'specialist_followup')
        throw new WorkflowOperationError('run_not_found', 404, '未找到防水运行');
      await readProjectAccess(tx, { enterpriseId, adminId: context.userId }, record.projectId, 'share');
      return debugView(record);
    });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AssistantError)
      return NextResponse.json({ success: false, error: error.code }, { status: error.status });
    return workflowApiError(error);
  }
}
