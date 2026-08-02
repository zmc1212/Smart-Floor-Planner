import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiChatSessionRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getTenantContext } from '@/lib/auth';

export async function GET(request: Request) {
  const context = await getTenantContext(request);
  if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!context.enterpriseId) return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
  try {
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const adminId = parsePostgresId(context.userId, 'userId');
    const sessions = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).list(enterpriseId, adminId)
    );
    return NextResponse.json({ success: true, data: sessions.map((session) => ({
      _id: session.id.toString(), title: session.title, lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
    })) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to load conversations' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await getTenantContext(request);
  if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!context.enterpriseId) return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
  try {
    const session = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).create({
        enterpriseId: parsePostgresId(context.enterpriseId, 'enterpriseId'),
        adminId: parsePostgresId(context.userId, 'userId'),
        title: 'New conversation',
        messages: [],
      })
    );
    return NextResponse.json({ success: true, data: { ...session, _id: session.id.toString() } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to create conversation' }, { status: 500 });
  }
}
