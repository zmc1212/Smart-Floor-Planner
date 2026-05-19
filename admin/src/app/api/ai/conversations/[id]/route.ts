import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { AiChatSession } from '@/models/AiChatSession';
import type { Types } from 'mongoose';

type ChatSessionResponseMessage = {
  _id?: Types.ObjectId;
  role: 'user' | 'assistant' | 'system';
  content: string;
  uiPayload?: unknown;
  createdAt?: Date;
};

// Get specific conversation
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await dbConnect();
  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const session = await AiChatSession.findOne({
      _id: id,
      enterpriseId: context.enterpriseId as unknown as Types.ObjectId,
      adminId: context.userId as unknown as Types.ObjectId,
    });

    if (!session) {
      return NextResponse.json({ success: false, error: '对话不存在' }, { status: 404 });
    }

    const sessionObject = session.toObject();

    return NextResponse.json({
      success: true,
      data: {
        ...sessionObject,
        messages: (sessionObject.messages as ChatSessionResponseMessage[]).map((message) => ({
          _id: message._id,
          role: message.role,
          content: message.content,
          uiPayload: message.uiPayload,
          createdAt: message.createdAt,
        })),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// Delete conversation
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await dbConnect();
  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const result = await AiChatSession.deleteOne({
      _id: id,
      enterpriseId: context.enterpriseId as unknown as Types.ObjectId,
      adminId: context.userId as unknown as Types.ObjectId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, error: '对话不存在或无权删除' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: '已删除' });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
