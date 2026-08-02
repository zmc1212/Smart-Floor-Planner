import { NextRequest, NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  AiChatSessionRepository,
  type AiChatMessage,
  type AiChatSessionRecord,
} from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getTenantContext } from '@/lib/auth';
import { runAgent, type Message } from '@/lib/ai/agent';

const MAX_AGENT_HISTORY_MESSAGES = 12;
const MAX_AGENT_HISTORY_CHARS = 24000;
const MAX_STORED_MESSAGE_CHARS = 8000;

function cleanAgentContent(content: string) {
  return content.replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/g, '').trim();
}

function truncateContent(content: string, maxLength = MAX_STORED_MESSAGE_CHARS) {
  return content.length > maxLength ? `${content.slice(0, maxLength)}\n\n[Content truncated]` : content;
}

function buildBoundedHistory(messages: Array<Record<string, unknown>>): Message[] {
  const recentMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_AGENT_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role as Message['role'], content: truncateContent(cleanAgentContent(String(message.content || '')), 4000) }))
    .filter((message) => message.content);
  let totalChars = 0;
  const bounded: Message[] = [];
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    totalChars += message.content.length;
    if (totalChars > MAX_AGENT_HISTORY_CHARS) break;
    bounded.unshift(message);
  }
  return bounded;
}

export async function POST(req: NextRequest) {
  try {
    const context = await getTenantContext(req);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!context.enterpriseId) return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
    const body = await req.json() as { messages: Message[]; conversationId?: string; contextHint?: string; hiddenInstruction?: string };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid messages' }, { status: 400 });
    }
    const enterpriseId = parsePostgresId(context.enterpriseId, 'enterpriseId');
    const adminId = parsePostgresId(context.userId, 'userId');
    const lastUserMsg = body.messages[body.messages.length - 1];
    let session: AiChatSessionRecord | null = await withAdminPostgresTransaction(context, async (transaction) => {
      const repository = new AiChatSessionRepository(transaction);
      if (body.conversationId) {
        const existing = await repository.findById(parsePostgresId(body.conversationId, 'conversation id'), enterpriseId, adminId);
        if (existing) return existing;
      }
      return repository.create({
        enterpriseId, adminId, title: String(lastUserMsg.content || '').slice(0, 30) || 'New conversation', messages: [],
      });
    });
    if (!session) throw new Error('Conversation not found');
    const userMessage: AiChatMessage = {
      role: lastUserMsg.role === 'assistant' || lastUserMsg.role === 'system' ? lastUserMsg.role : 'user',
      content: truncateContent(cleanAgentContent(String(lastUserMsg.content || ''))),
      createdAt: new Date(),
    };
    const sessionId = session.id;
    session = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).appendMessage(sessionId, enterpriseId, adminId, userMessage)
    );
    if (!session) throw new Error('Conversation not found');
    const history = buildBoundedHistory(session.messages);
    const hiddenContext = [body.contextHint, body.hiddenInstruction].filter(Boolean).join('\n');
    if (hiddenContext && history.at(-1)?.role === 'user') {
      history[history.length - 1].content = `${history[history.length - 1].content}\n\n${truncateContent(hiddenContext, 1000)}`;
    }
    const agentResponse = await runAgent(history, {
      userId: context.userId, enterpriseId: context.enterpriseId, role: context.role, userName: context.username,
    });
    const currentSessionId = session.id;
    session = await withAdminPostgresTransaction(context, (transaction) =>
      new AiChatSessionRepository(transaction).appendMessage(currentSessionId, enterpriseId, adminId, {
        role: 'assistant', content: truncateContent(cleanAgentContent(agentResponse.content || '')),
        uiPayload: agentResponse.uiPayload, createdAt: new Date(),
      })
    );
    if (!session) throw new Error('Conversation not found');
    if (session.messages.length === 2) {
      await withAdminPostgresTransaction(context, (transaction) =>
        new AiChatSessionRepository(transaction).updateTitle(
          session.id, enterpriseId, adminId, String(lastUserMsg.content || '').slice(0, 30)
        )
      );
    }
    return NextResponse.json({ success: true, data: { ...agentResponse, conversationId: session.id.toString() } });
  } catch (error) {
    console.error('[Agent API Error]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
  }
}
