import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { FloorPlanRepository, type FloorPlanWithCreator } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { renderMiniAiFloorPlanControlPng } from '@/lib/ai/mini-ai-floorplan';
import { canAccessMiniProgramFloorPlan } from '@/lib/floor-plan-access';
import { renderFloorPlanPreviewPng } from '@/lib/floor-plan-preview';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

async function loadPreviewFloorPlan(request: Request, id: string) {
  const planId = parsePostgresId(id, 'floor plan id');
  const mini = await resolveMiniProgramContext(request);
  if (mini) {
    const plan = await withMiniProgramPostgresTransaction(mini, (transaction) =>
      new FloorPlanRepository(transaction).findById(planId)
    );
    if (!plan || !canAccessMiniProgramFloorPlan(plan, mini)) return { status: 404 as const };
    return { plan };
  }

  const admin = await getTenantContext(request);
  if (!admin) return { status: 401 as const };
  const plan = await withAdminPostgresTransaction(admin, (transaction) =>
    new FloorPlanRepository(transaction).findById(planId)
  );
  if (!plan) return { status: 404 as const };
  return { plan };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const loaded = await loadPreviewFloorPlan(request, id);
    if ('status' in loaded) {
      return NextResponse.json(
        { success: false, error: loaded.status === 401 ? 'Unauthorized' : 'Floor plan not found' },
        { status: loaded.status }
      );
    }

    const plan: FloorPlanWithCreator = loaded.plan;
    let buffer: Buffer;
    try {
      buffer = await renderFloorPlanPreviewPng(plan);
    } catch (error) {
      console.error('[floor-plan-preview] canvas render failed, using SVG fallback', error);
      buffer = await renderMiniAiFloorPlanControlPng(plan.layoutData);
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: unknown) {
    console.error('[floor-plan-preview GET]', error);
    const message = error instanceof Error ? error.message : '加载户型预览失败';
    const status = (error as { status?: number }).status;
    return NextResponse.json(
      { success: false, error: message },
      { status: status && status >= 400 ? status : 500 }
    );
  }
}
