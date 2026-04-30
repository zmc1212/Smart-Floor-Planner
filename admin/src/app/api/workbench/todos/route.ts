import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { getMiniProgramStaffContext } from '@/lib/promotion-workflow';
import { listWorkbenchTodos, WorkbenchTodoView } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const view = (searchParams.get('view') || 'mine') as WorkbenchTodoView;
    const openid = searchParams.get('openid');

    if (openid) {
      const { staff } = await getMiniProgramStaffContext(openid);
      if (!staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }

      const todos = await listWorkbenchTodos({
        role: staff.role,
        userId: String(staff._id),
        enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
        view,
      });

      return NextResponse.json({ success: true, data: todos });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const todos = await listWorkbenchTodos({
      role: context.role,
      userId: context.userId,
      enterpriseId: context.enterpriseId,
      view,
    });

    return NextResponse.json({ success: true, data: todos });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
