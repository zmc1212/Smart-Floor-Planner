import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { ENTERPRISE_MANAGEMENT_ROLES, isEnterpriseManagementRole } from '@/lib/admin-user-roles';
import { AssistantError, fail, id } from '@/lib/assistant/contracts';
import { staffRenovationProfile } from '@/lib/assistant/requirements/renovation-profile';
import { withTenantRoute } from '@/lib/tenant-route';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantRoute(request, { roles: [...ENTERPRISE_MANAGEMENT_ROLES, 'designer'], requireEnterprise: true }, async actor => {
    const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      const leadId = id((await params).id), enterpriseId = id(actor.enterpriseId);
      const profile = await withTenantTransaction(enterpriseId, async tx => {
        // Use the live selected-enterprise account check also used by XiaoK reception.
        const viewer = await one(tx, sql`select role from app.assistant_handoff_staff_identity(
          ${actor.userId}::bigint,${enterpriseId}::bigint)`);
        if (!viewer || viewer.role !== actor.role) fail('assistant_capability_forbidden', 403);
        const lead = await one(tx, sql`select l.id from app.leads l
          join app.enterprises e on e.id=l.enterprise_id and e.status='active'
          where l.enterprise_id=${enterpriseId} and l.id=${leadId} and l.archived_at is null and l.status<>'closed'
            and (${isEnterpriseManagementRole(actor.role)} or l.assigned_to=${actor.userId}) for share of l,e`);
        if (!lead) fail('assistant_resource_not_found', 404);
        return staffRenovationProfile(tx, enterpriseId, leadId);
      });
      return respond({ success: true, data: profile });
    } catch (error) {
      const failure = error instanceof AssistantError ? error : new AssistantError('assistant_unavailable', 503);
      return respond({ success: false, code: failure.code, error: '暂时无法读取装修画像' }, failure.status);
    }
  });
}
