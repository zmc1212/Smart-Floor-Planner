import { NextResponse } from 'next/server';
import { parsePostgresId, staffNotificationToDto } from '@/db/postgres-dto';
import { StaffNotificationRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const onlyUnread = new URL(request.url).searchParams.get('unread') === '1';
    const result = await withMiniProgramPostgresTransaction(context, async (transaction) => new StaffNotificationRepository(transaction).list(parsePostgresId(context.staff!._id, 'staff id'), onlyUnread));
    return NextResponse.json({ success: true, data: result.map(staffNotificationToDto), unreadCount: result.filter((item) => item.status === 'unread').length });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取通知失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = (await request.json()) as { ids?: unknown[] };
    if (!Array.isArray(body.ids)) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    const ids = body.ids.map((id) => parsePostgresId(id, 'notification id'));
    const marked = await withMiniProgramPostgresTransaction(context, (transaction) => new StaffNotificationRepository(transaction).markRead(ids, parsePostgresId(context.staff!._id, 'staff id')));
    return NextResponse.json({ success: true, marked });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '通知已读失败' }, { status: 400 });
  }
}
