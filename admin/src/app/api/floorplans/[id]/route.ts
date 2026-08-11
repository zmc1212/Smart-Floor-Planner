import { NextResponse } from 'next/server';
import { floorPlanToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  FloorPlanRepository,
  LeadRepository,
} from '@/db/repositories';
import { canAccessMiniProgramFloorPlan } from '@/lib/floor-plan-access';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const plan = await withMiniProgramPostgresTransaction(
      context,
      (transaction) =>
        new FloorPlanRepository(transaction).findById(
          parsePostgresId(id, 'floor plan id')
        )
    );
    if (!plan || !canAccessMiniProgramFloorPlan(plan, context)) {
      return NextResponse.json(
        { success: false, error: 'Floor plan not found' },
        { status: 404 }
      );
    }
    const lead = await withMiniProgramPostgresTransaction(
      context,
      (transaction) =>
        new LeadRepository(transaction).findByFloorPlanId(plan.id)
    );
    return NextResponse.json({
      success: true,
      data: {
        ...floorPlanToDto(plan, {
          lead,
          measurementSequence: lead?.floorPlanRecords.find(
            (record) => record.id === plan.id
          )?.measurementSequence,
        }),
        communityName: lead?.communityName || null,
        lead: lead
          ? {
              _id: lead.id.toString(),
              name: lead.name,
              communityName: lead.communityName,
              archivedAt: lead.archivedAt,
              isArchived: Boolean(lead.archivedAt),
            }
          : null,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const planId = parsePostgresId(id, 'floor plan id');
    const body = (await request.json()) as FloorPlanUpdateBody;
    if (!isFormalSurveyLayout(body.layoutData)) {
      return NextResponse.json(
        {
          success: false,
          error: 'layoutData must use the formal surveyGraph contract',
        },
        { status: 400 }
      );
    }

    const updated = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const repository = new FloorPlanRepository(transaction);
        const current = await repository.findById(planId);
        if (!current || !canAccessMiniProgramFloorPlan(current, context)) return null;
        const nextStatus = body.status || current.status;
        const plan = await repository.update(planId, {
          name: body.name?.trim() || current.name,
          layoutData: body.layoutData as Record<string, unknown>,
          status: nextStatus,
          completedAt:
            current.status !== 'completed' && nextStatus === 'completed'
              ? new Date()
              : current.completedAt,
          staffId: context.staff
            ? parsePostgresId(context.staff._id, 'staff id')
            : current.staffId,
          enterpriseId: context.staff?.enterpriseId
            ? parsePostgresId(
                context.staff.enterpriseId,
                'staff enterprise id'
              )
            : current.enterpriseId,
        });
        if (!plan || !body.leadId) return plan;

        const lead = await new LeadRepository(transaction).findById(
          parsePostgresId(body.leadId, 'leadId')
        );
        if (!lead) throw new Error('Lead not found or access denied');
        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        if (
          context.staff &&
          context.staff.role !== 'enterprise_admin' &&
          lead.promoterId !== staffId &&
          lead.assignedTo !== staffId
        ) {
          throw new Error('Lead access denied');
        }
        if (!context.staff && lead.phone !== context.user.phone) {
          throw new Error('Lead access denied');
        }
        await linkFloorPlanToLead(transaction, lead.id, plan.id);
        return plan;
      }
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Floor plan not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: floorPlanToDto(updated) });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    return NextResponse.json(
      { success: false, error: message, code: (error as { code?: string })?.code },
      {
        status: (error as { status?: number })?.status
          || (message.includes('access denied') ? 403 : 500),
      }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { id } = await params;
    const deleted = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const repository = new FloorPlanRepository(transaction);
        const plan = await repository.findById(
          parsePostgresId(id, 'floor plan id')
        );
        if (!plan || !canAccessMiniProgramFloorPlan(plan, context)) return null;
        return repository.delete(plan.id);
      }
    );
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Floor plan not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
