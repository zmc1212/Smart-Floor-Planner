import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { AiChatSession } from '@/models/AiChatSession';

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
      enterpriseId: context.enterpriseId,
      adminId: context.userId,
    });

    if (!session) {
      return NextResponse.json({ success: false, error: '对话不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: session });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
      enterpriseId: context.enterpriseId,
      adminId: context.userId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, error: '对话不存在或无权删除' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: '已删除' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
