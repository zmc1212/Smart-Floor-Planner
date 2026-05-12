import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { runAgent, Message } from '@/lib/ai/agent';
import { AiChatSession } from '@/models/AiChatSession';

export async function POST(req: NextRequest) {
  await dbConnect();
  try {
    const context = await getTenantContext(req);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, conversationId } = body as { messages: Message[], conversationId?: string };

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
      session = await AiChatSession.create({
        enterpriseId: context.enterpriseId,
        adminId: context.userId,
        title: messages[messages.length - 1].content.slice(0, 30),
        messages: []
      });
    }

    // 2. 将最新的用户消息存入数据库
    const lastUserMsg = messages[messages.length - 1];
    session.messages.push({
      role: lastUserMsg.role as any,
      content: lastUserMsg.content,
      createdAt: new Date()
    });

    // 3. 使用完整历史记录运行 Agent
    const history = session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const agentResponse = await runAgent(history, {
      userId: context.userId,
      enterpriseId: context.enterpriseId || '',
      role: context.role,
      userName: context.username
    });

    // 4. 将助手回复存入数据库
    session.messages.push({
      role: 'assistant',
      content: agentResponse.content,
      createdAt: new Date()
    });
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

  } catch (error: any) {
    console.error('[Agent API Error]', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Internal Server Error'
    }, { status: 500 });
  }
}
