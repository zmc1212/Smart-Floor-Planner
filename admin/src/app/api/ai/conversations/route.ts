import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { AiChatSession } from '@/models/AiChatSession';

// List conversations
export async function GET(request: Request) {
  await dbConnect();
  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  }

  try {
    const sessions = await AiChatSession.find({
      enterpriseId: context.enterpriseId,
      adminId: context.userId,
    })
      .sort({ lastMessageAt: -1 })
      .select('title lastMessageAt createdAt')
      .limit(50);

    return NextResponse.json({ success: true, data: sessions });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Create a new conversation
export async function POST(request: Request) {
  await dbConnect();
  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  }

  try {
    const session = await AiChatSession.create({
      enterpriseId: context.enterpriseId,
      adminId: context.userId,
      title: '新对话',
      messages: [],
    });

    return NextResponse.json({ success: true, data: session });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
