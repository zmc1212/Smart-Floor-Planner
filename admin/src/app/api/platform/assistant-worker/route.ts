import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { readWorkerHeartbeat } from '@/lib/assistant/operations';
import { withTenantRoute } from '@/lib/tenant-route';
import { PilotProjectScopeService, readPilotProjectScope } from '@/lib/xiaok-v1/pilot-project-scope';
import {
  resolveWorkerDeployment, saveWorkerRuntimeConfig, workerEnterpriseId, workerPilotId,
} from '@/lib/xiaok-v1/worker-runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

type ProjectRow = { id: string; name: string; status: string; currentStageKey: string | null };

async function readEnterpriseState(enterpriseId: string, pilotId: string | null) {
  return withTenantTransaction(enterpriseId, async tx => {
    const enterprise = (await tx.execute(sql`select id::text as id,name,status
      from app.enterprises where id=${enterpriseId}`)).rows[0] as { id: string; name: string; status: string } | undefined;
    if (!enterprise) fail('worker_settings_enterprise_unavailable', 422);
    const projects = await rows<ProjectRow>(tx, sql`select p.id::text as id,p.name,p.status,
        p.current_stage_key as "currentStageKey"
      from app.construction_projects p
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where p.enterprise_id=${enterpriseId} and p.status='active' and l.archived_at is null
      order by p.id`);
    const scope = pilotId ? await readPilotProjectScope(tx, enterpriseId, pilotId) : null;
    return { enterprise, projects, scope };
  }, { readOnly: true });
}

async function snapshot(enterpriseId: string | null, pilotId: string | null) {
  const deployment = await resolveWorkerDeployment();
  const state = enterpriseId ? await readEnterpriseState(enterpriseId, pilotId) : null;
  return {
    deployment: {
      source: deployment.source,
      config: deployment.config,
      gate: deployment.gate,
    },
    enterprise: state?.enterprise ?? null,
    scope: state?.scope ?? null,
    projects: state?.projects ?? null,
    worker: await readWorkerHeartbeat(),
  };
}

/** Read the saved Worker switch, the pilot scope and (optionally) the projects
 * an operator can put in scope. Read-only; the Worker still resolves the same
 * gate on every tick. */
export async function GET(request: Request) {
  return withTenantRoute(request, { roles: ['super_admin'] }, async () => {
    try {
      const url = new URL(request.url);
      const rawEnterpriseId = url.searchParams.get('enterpriseId');
      const rawPilotId = url.searchParams.get('pilotId');
      const enterpriseId = rawEnterpriseId ? workerEnterpriseId(rawEnterpriseId) : null;
      const pilotId = rawPilotId ? workerPilotId(rawPilotId) : null;
      return NextResponse.json({ success: true, data: await snapshot(enterpriseId, pilotId) }, { headers });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof AssistantError ? error.code : 'worker_settings_unavailable',
      }, { headers, status: error instanceof AssistantError ? error.status : 503 });
    }
  });
}

/** Save the switch and, when project ids are supplied, the pilot scope.
 *
 * Only a platform super admin may do this. An enabled switch still requires an
 * active, non-empty pilot scope: the Worker never widens delivery to an
 * enterprise and never invents a scope when the saved one is empty. */
export async function PATCH(request: Request) {
  return withTenantRoute(request, { roles: ['super_admin'] }, async context => {
    try {
      const raw = await request.text();
      if (raw.length > 32000) fail('worker_settings_invalid', 413);
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('worker_settings_invalid', 422);
        body = parsed as Record<string, unknown>;
      } catch {
        fail('worker_settings_invalid', 422);
      }

      const enabled = typeof body.enabled === 'boolean' ? body.enabled : fail('worker_settings_invalid', 422);
      const enterpriseId = typeof body.enterpriseId === 'string' && body.enterpriseId.trim()
        ? workerEnterpriseId(body.enterpriseId) : null;
      const pilotId = typeof body.pilotId === 'string' && body.pilotId.trim()
        ? workerPilotId(body.pilotId) : null;

      if (body.projectIds !== undefined) {
        if (!enterpriseId || !pilotId) fail('worker_settings_invalid', 422);
        const expectedScopeVersion = typeof body.expectedScopeVersion === 'number'
          ? body.expectedScopeVersion : 0;
        await new PilotProjectScopeService({ enterpriseId, adminId: context.userId })
          .save(pilotId, { projectIds: body.projectIds, status: 'active', expectedVersion: expectedScopeVersion });
      }

      if (enabled) {
        if (!enterpriseId || !pilotId) fail('worker_settings_invalid', 422);
        const scope = await withTenantTransaction(enterpriseId,
          tx => readPilotProjectScope(tx, enterpriseId, pilotId), { readOnly: true });
        if (!scope || scope.status !== 'active' || !scope.projectIds.length) fail('worker_scope_required', 422);
      }

      const config = await saveWorkerRuntimeConfig({
        enabled, enterpriseId, pilotId,
        expectedVersion: body.expectedVersion,
        updatedBy: context.userId,
      });
      return NextResponse.json({
        success: true,
        data: { ...(await snapshot(enterpriseId, pilotId)), saved: config },
      }, { headers });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof AssistantError ? error.code : 'worker_settings_unavailable',
      }, { headers, status: error instanceof AssistantError ? error.status : 503 });
    }
  });
}
