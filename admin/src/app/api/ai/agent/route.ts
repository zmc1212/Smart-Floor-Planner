import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { runAgent, Message } from '@/lib/ai/agent';
import { AiChatSession } from '@/models/AiChatSession';
import type { Types } from 'mongoose';

const MAX_AGENT_HISTORY_MESSAGES = 12;
const MAX_AGENT_HISTORY_CHARS = 24000;
const MAX_STORED_MESSAGE_CHARS = 8000;

function cleanAgentContent(content: string) {
  return content
    .replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/g, '')
    .trim();
}

function truncateContent(content: string, maxLength = MAX_STORED_MESSAGE_CHARS) {
  return content.length > maxLength
    ? `${content.slice(0, maxLength)}\n\n[内容过长，已截断]`
    : content;
}

function buildBoundedHistory(messages: Array<{ role: string; content: string }>): Message[] {
  const recentMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_AGENT_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role as Message['role'],
      content: truncateContent(cleanAgentContent(message.content), 4000),
    }))
    .filter((message) => message.content);

  let totalChars = 0;
  const bounded: Message[] = [];

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    totalChars += message.content.length;
    if (totalChars > MAX_AGENT_HISTORY_CHARS) {
      break;
    }
    bounded.unshift(message);
  }

  return bounded;
}

export async function POST(req: NextRequest) {
  await dbConnect();
  try {
    const context = await getTenantContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, conversationId, contextHint, hiddenInstruction } = body as {
      messages: Message[];
      conversationId?: string;
      contextHint?: string;
      hiddenInstruction?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ success: false, error: 'Invalid messages' }, { status: 400 });
    }

    // 1. 获取或创建会话
    let session;
    if (conversationId) {
      session = await AiChatSession.findOne({
        _id: conversationId,
        adminId: context.userId
      });
    }

    if (!session) {
      if (!context.enterpriseId) {
        return NextResponse.json({ success: false, error: 'Enterprise context required' }, { status: 400 });
      }

      session = await AiChatSession.create({
        enterpriseId: context.enterpriseId as unknown as Types.ObjectId,
        adminId: context.userId as unknown as Types.ObjectId,
        title: messages[messages.length - 1].content.slice(0, 30),
        messages: []
      });
    }

    // 2. 将最新的用户消息存入数据库
    const lastUserMsg = messages[messages.length - 1];
    const lastUserContent = truncateContent(cleanAgentContent(lastUserMsg.content || ''));
    session.messages.push({
      role: lastUserMsg.role as 'user' | 'assistant' | 'system',
      content: lastUserContent,
      createdAt: new Date()
    });

    // 3. 使用有限历史记录运行 Agent，避免工具结果或旧长文本撑爆 LongCat 上下文
    const history = buildBoundedHistory(session.messages.map(m => ({
      role: m.role,
      content: m.content
    })));
    const hiddenContext = [contextHint, hiddenInstruction].filter(Boolean).join('\n');
    if (hiddenContext && history.length > 0) {
      const lastHistoryMessage = history[history.length - 1];
      if (lastHistoryMessage.role === 'user') {
        lastHistoryMessage.content = `${lastHistoryMessage.content}\n\n${truncateContent(hiddenContext, 1000)}`;
      }
    }

    const agentResponse = await runAgent(history, {
      userId: context.userId,
      enterpriseId: context.enterpriseId || '',
      role: context.role,
      userName: context.username
    });

    // 4. 将助手回复存入数据库
    session.messages.push({
      role: 'assistant',
      content: truncateContent(cleanAgentContent(agentResponse.content || '')),
      uiPayload: agentResponse.uiPayload,
      createdAt: new Date()
    });
    session.markModified('messages');
    session.lastMessageAt = new Date();

    // 如果是第一条对话，尝试生成一个更有意义的标题
    if (session.messages.length === 2) {
      session.title = lastUserMsg.content.slice(0, 30);
    }

    await session.save();

    return NextResponse.json({
      success: true,
      data: {
        ...agentResponse,
        conversationId: session._id
      }
    });

  } catch (error: unknown) {
    console.error('[Agent API Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal Server Error'
    }, { status: 500 });
  }
}
