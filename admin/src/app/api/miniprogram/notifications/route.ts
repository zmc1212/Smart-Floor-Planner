import { NextResponse } from 'next/server';
import { parsePostgresId, staffNotificationToDto } from '@/db/postgres-dto';
import { StaffNotificationRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const onlyUnread = searchParams.get('unread') === '1';
    const parsedLimit = parseInt(searchParams.get('limit') || '', 10);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 100);
    const staffId = parsePostgresId(context.staff!._id, 'staff id');
    const { rows, unreadCount } = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const repository = new StaffNotificationRepository(transaction);
        const [rows, unreadCount] = await Promise.all([
          repository.list(staffId, { onlyUnread, limit }),
          repository.countUnread(staffId),
        ]);
        return { rows, unreadCount };
      }
    );
    return NextResponse.json({ success: true, data: rows.map(staffNotificationToDto), unreadCount });
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
