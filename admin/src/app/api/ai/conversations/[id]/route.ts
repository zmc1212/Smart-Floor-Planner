import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AiChatSessionRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getTenantContext } from '@/lib/auth';

async function resolveContext(request: Request, id: string) {
  const context = await getTenantContext(request);
  if (!context) return null;
  if (!context.enterpriseId) throw new Error('Enterprise context required');
  return {
    context,
    sessionId: parsePostgresId(id, 'conversation id'),
    enterpriseId: parsePostgresId(context.enterpriseId, 'enterpriseId'),
    adminId: parsePostgresId(context.userId, 'userId'),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await resolveContext(request, (await params).id);
    if (!resolved) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const session = await withAdminPostgresTransaction(resolved.context, (transaction) =>
      new AiChatSessionRepository(transaction).findById(
        resolved.sessionId, resolved.enterpriseId, resolved.adminId
      )
    );
    if (!session) return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: {
      ...session, _id: session.id.toString(),
      messages: session.messages.map((message) => ({
        role: message.role, content: message.content, uiPayload: message.uiPayload,
        createdAt: message.createdAt,
      })),
    } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to load conversation' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolved = await resolveContext(request, (await params).id);
    if (!resolved) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const deleted = await withAdminPostgresTransaction(resolved.context, (transaction) =>
      new AiChatSessionRepository(transaction).delete(
        resolved.sessionId, resolved.enterpriseId, resolved.adminId
      )
    );
    if (!deleted) return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to delete conversation' }, { status: 500 });
  }
}
