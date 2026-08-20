import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { CustomerProjectRepository } from '@/db/repositories';
import { renderMiniAiFloorPlanControlPng } from '@/lib/ai/mini-ai-floorplan';
import { renderFloorPlanPreviewPng } from '@/lib/floor-plan-preview';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    if (context.mode !== 'customer') {
      return NextResponse.json({ success: false, error: '仅客户本人可查看户型档案' }, { status: 403 });
    }
    const { leadId: leadIdText } = await params;
    const leadId = parsePostgresId(leadIdText, 'lead id');
    const project = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new CustomerProjectRepository(transaction).findCustomerProject(
        parsePostgresId(context.user._id, 'customer user id'),
        leadId
      )
    );
    if (!project?.formalFloorPlan) {
      return NextResponse.json({ success: false, error: '户型档案不存在或无权访问' }, { status: 404 });
    }

    let buffer: Buffer;
    try {
      buffer = await renderFloorPlanPreviewPng(project.formalFloorPlan);
    } catch (error) {
      console.error('[customer-project floor-plan preview] canvas render failed, using SVG fallback', error);
      buffer = await renderMiniAiFloorPlanControlPng(project.formalFloorPlan.layoutData);
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取户型档案失败' },
      { status: 400 }
    );
  }
}
