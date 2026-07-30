import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiCreationTask } from '@/models/AiCreationTask';
import { AiGeneration } from '@/models/AiGeneration';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const deletedAt = new Date();
      const task = await AiCreationTask.findOneAndUpdate(
        { _id: id, enterpriseId: context.enterpriseId, deletedAt: { $exists: false } },
        { $set: { deletedAt, status: 'archived' } },
        { returnDocument: 'after' }
      );
      if (!task) return NextResponse.json({ success: false, error: '创作任务不存在' }, { status: 404 });
      await AiGeneration.updateMany({ creationTaskId: task._id }, { $set: { deletedAt } });
      return NextResponse.json({ success: true });
    });
  } catch (error) {
    console.error('[AI Creation Task DELETE]', error);
    return NextResponse.json({ success: false, error: '删除任务失败' }, { status: 500 });
  }
}
