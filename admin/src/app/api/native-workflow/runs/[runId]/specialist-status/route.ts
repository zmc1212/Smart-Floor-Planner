import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { AssistantError } from '@/lib/assistant/contracts';
import { getTenantContext } from '@/lib/auth';
import { readProjectAccess } from '@/lib/native-workflow/live/project-access';
import { createPostgresWorkflowRunStore } from '@/lib/native-workflow/live/runtime-postgres-stores';
import { specialistStatus } from '@/lib/native-workflow/live/specialist-status';
import { getNativeWorkflowService, requirePlatformAdmin, workflowApiError } from '@/lib/native-workflow/server';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    const missing = () => new WorkflowOperationError('run_not_found', 404, '未找到专业运行');
    if (!/^specialist:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(runId)) throw missing();
    const data = await withTenantTransaction(enterpriseId, async tx => {
      const id = runId.slice('specialist:'.length);
      const d = await one(tx, sql`select project_id::text,scope,current_status,evidence,created_at,updated_at
        from app.native_workflow_delegations where enterprise_id=${enterpriseId} and id=${id}
        and scope->'workflow' is not null`);
      if (!d) throw missing();
      const projectId = String(d.project_id);
      await readProjectAccess(tx, { enterpriseId, adminId: context.userId }, projectId, 'share');
      const record = await createPostgresWorkflowRunStore(enterpriseId, tx).get(runId);
      const scope = d.scope as Parameters<typeof specialistStatus>[2]['scope'];
      if (record && (record.projectId !== projectId || record.binding.event.eventType !== 'specialist_followup'
        || record.binding.definitionId !== scope.workflow.templateId || record.binding.revision !== scope.workflow.revision
        || record.binding.digest !== scope.workflow.digest)) throw missing();
      const { record: definition } = await getNativeWorkflowService().getDefinition(scope.workflow.templateId);
      const published = definition.versions.find(version => version.revision === scope.workflow.revision && version.digest === scope.workflow.digest);
      if (!published) throw missing();
      return specialistStatus(tx, enterpriseId, { id, scope, status: String(d.current_status),
        evidence: d.evidence as Parameters<typeof specialistStatus>[2]['evidence'],
        createdAt: new Date(d.created_at as Date).toISOString(), updatedAt: new Date(d.updated_at as Date).toISOString() }, record, published.definition);
    });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AssistantError)
      return NextResponse.json({ success: false, error: error.code }, { status: error.status });
    return workflowApiError(error);
  }
}
