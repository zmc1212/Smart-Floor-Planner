import { NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import {
  listWorkbenchTodos,
  type WorkbenchTodoView,
} from '@/lib/postgres-workflow-automation';

export const dynamic = 'force-dynamic';

const TODO_VIEWS = new Set<WorkbenchTodoView>(['mine', 'overdue', 'today']);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedView = (searchParams.get('view') || 'mine') as WorkbenchTodoView;
    if (!TODO_VIEWS.has(requestedView)) {
      return NextResponse.json({ success: false, error: 'Invalid view' }, { status: 400 });
    }

    const mini = await resolveMiniProgramContext(request);
    if (mini) {
      if (!mini.staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }
      const todos = await listWorkbenchTodos({
        role: mini.staff.role,
        userId: mini.staff._id,
        enterpriseId: mini.staff.enterpriseId ?? mini.enterpriseId ?? null,
        view: requestedView,
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
      view: requestedView,
    });
    return NextResponse.json({ success: true, data: todos });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
