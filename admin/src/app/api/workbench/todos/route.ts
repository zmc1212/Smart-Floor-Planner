import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { tenantStorage } from '@/lib/tenant-context';
import { listWorkbenchTodos, WorkbenchTodoView } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const view = (searchParams.get('view') || 'mine') as WorkbenchTodoView;

    // Try Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;

      return await tenantStorage.run(
        {
          enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
          role: staff.role,
          userId: String(staff._id),
        },
        async () => {
          const todos = await listWorkbenchTodos({
            role: staff.role,
            userId: String(staff._id),
            enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
            view,
          });

          return NextResponse.json({ success: true, data: todos });
        }
      );
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await tenantStorage.run(
      {
        enterpriseId: context.enterpriseId,
        role: context.role,
        userId: context.userId,
      },
      async () => {
        const todos = await listWorkbenchTodos({
          role: context.role,
          userId: context.userId,
          enterpriseId: context.enterpriseId,
          view,
        });

        return NextResponse.json({ success: true, data: todos });
      }
    );
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
