import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';
import { isFormalSurveyLayout } from '@/lib/survey-graph';

interface FloorPlanUpdateBody {
  name?: string;
  layoutData?: unknown;
  status?: 'draft' | 'completed';
  leadId?: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function canAccessPlan(plan: { creator?: unknown; enterpriseId?: unknown }, context: Awaited<ReturnType<typeof resolveMiniProgramContext>>) {
  if (!context) return false;
  if (context.staff) {
    return String(plan.enterpriseId || '') === String(context.staff.enterpriseId || '');
  }
  return String(plan.creator || '') === String(context.user._id || '');
}

async function getPlanForContext(id: string, context: Awaited<ReturnType<typeof resolveMiniProgramContext>>) {
  const plan = await FloorPlan.findById(id);
  return plan && canAccessPlan(plan, context) ? plan : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(req);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const plan = await getPlanForContext(id, context);
    if (!plan) return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: plan });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(req);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await req.json() as FloorPlanUpdateBody;
    if (!isFormalSurveyLayout(body.layoutData)) {
      return NextResponse.json({ success: false, error: 'layoutData must use the formal surveyGraph contract' }, { status: 400 });
    }
    const plan = await getPlanForContext(id, context);
    if (!plan) return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
    const previousStatus = plan.status;
    const nextStatus = body.status || plan.status;
    plan.name = body.name || plan.name;
    plan.layoutData = body.layoutData;
    plan.status = nextStatus;
    if (previousStatus !== 'completed' && nextStatus === 'completed') {
      plan.completedAt = new Date();
    }
    if (context.staff) {
      plan.staffId = context.staff._id;
      plan.enterpriseId = context.staff.enterpriseId;
    }
    await plan.save();
    if (body.leadId) await linkFloorPlanToLead(body.leadId, plan._id);
    return NextResponse.json({ success: true, data: plan });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(req);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const plan = await getPlanForContext(id, context);
    if (!plan) return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });

    const tenantFilter = plan.enterpriseId ? { enterpriseId: plan.enterpriseId } : {};
    await Promise.all([
      Lead.updateMany(
        { ...tenantFilter, floorPlanIds: plan._id },
        { $pull: { floorPlanIds: plan._id } }
      ),
      Lead.updateMany(
        { ...tenantFilter, primaryFloorPlanId: plan._id },
        { $unset: { primaryFloorPlanId: 1 } }
      )
    ]);
    await plan.deleteOne();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
