import { NextResponse } from 'next/server';
import { workflowNotificationToDto } from '@/db/postgres-dto';
import { WorkflowNotificationRepository } from '@/db/repositories';
import { getPlatformB2BTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { withTenantRoute } from '@/lib/tenant-route';
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { page, limit } = getPaginationParams(request.url);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    if (status && !['sent', 'failed', 'skipped'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'] },
      async (context) => {
        if (context.role === 'enterprise_admin' && !context.enterpriseId) {
          return NextResponse.json(
            { success: false, error: 'Please select an enterprise first' },
            { status: 400 }
          );
        }
        const b2bContext = getPlatformB2BTenantContext(context);
        const result = await withAdminPostgresTransaction(b2bContext, (transaction) =>
          new WorkflowNotificationRepository(transaction).list({
            status: status || undefined,
            page,
            limit,
          })
        );
        return NextResponse.json({
          success: true,
          data: result.rows.map(workflowNotificationToDto),
          pagination: createPaginationMetadata(result.total, page, limit),
          stats: {
            sent: result.statusCounts.sent || 0,
            failed: result.statusCounts.failed || 0,
            skipped: result.statusCounts.skipped || 0,
          },
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
