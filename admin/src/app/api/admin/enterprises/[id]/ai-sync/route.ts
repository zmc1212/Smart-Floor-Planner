import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { syncEnterprisePollinationsSnapshot } from '@/lib/ai/enterprise-ai';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const snapshot = await syncEnterprisePollinationsSnapshot(id);
      return NextResponse.json({ success: true, data: snapshot });
    });
  } catch (error) {
    console.error('[Enterprise AI Sync POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务端错误' },
      { status: 500 }
    );
  }
}
