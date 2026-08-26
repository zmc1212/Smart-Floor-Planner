import { NextResponse } from 'next/server';
import { floorPlanToDto, parsePostgresId } from '@/db/postgres-dto';
import {
  FloorPlanRepository,
  LeadRepository,
  AppointmentRepository,
} from '@/db/repositories';
import { persistAndAttachFloorPlanPreview } from '@/lib/floor-plan-preview';
import {
  canAccessMiniProgramFloorPlan,
  canReadMiniProgramFloorPlan,
} from '@/lib/floor-plan-access';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';
import { canStaffMutateLeadSurvey } from '@/lib/lead-staff-access';
import { canDeleteLeadFloorPlan } from '@/lib/lead-status';
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
    const loaded = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const plan = await new FloorPlanRepository(transaction).findById(
          parsePostgresId(id, 'floor plan id')
        );
        if (!plan) return { plan: null, lead: null };
        const lead = await new LeadRepository(transaction).findByFloorPlanId(plan.id);
        return { plan, lead };
      }
    );
    if (!loaded.plan || !canReadMiniProgramFloorPlan(loaded.plan, context, loaded.lead)) {
      return NextResponse.json(
        { success: false, error: 'Floor plan not found' },
        { status: 404 }
      );
    }
    const plan = loaded.plan;
    const lead = loaded.lead;
    return NextResponse.json({
      success: true,
      data: {
        ...floorPlanToDto(plan, {
          lead,
          measurementSequence: lead?.floorPlanRecords?.find(
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
        const becameCompleted =
          current.status !== 'completed' && nextStatus === 'completed';
        const plan = await repository.update(planId, {
          name: body.name?.trim() || current.name,
          layoutData: body.layoutData as Record<string, unknown>,
          status: nextStatus,
          completedAt:
            becameCompleted
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
        if (!plan) return null;
        if (!body.leadId) {
          const linkedLead = nextStatus === 'completed'
            ? await new LeadRepository(transaction).findByFloorPlanId(plan.id)
            : null;
          if (linkedLead?.enterpriseId && linkedLead.assignedTo && nextStatus === 'completed') {
            await new AppointmentRepository(transaction).tryCreateOnSiteVisit({
              enterpriseId: linkedLead.enterpriseId,
              leadId: linkedLead.id,
              actorUserId: /^[1-9]\d*$/.test(context.user._id)
                ? BigInt(context.user._id)
                : null,
              eventKey: `on-site-floorplan:${linkedLead.id.toString()}:${plan.id.toString()}`,
            });
          }
          return { plan, becameCompleted, lead: linkedLead };
        }

        const lead = await new LeadRepository(transaction).findById(
          parsePostgresId(body.leadId, 'leadId')
        );
        if (!lead) throw new Error('Lead not found or access denied');
        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        if (
          context.staff &&
          !canStaffMutateLeadSurvey({
            staffRole: context.staff.role,
            staffId,
            promoterId: lead.promoterId,
            assignedTo: lead.assignedTo,
            measurerId: lead.measurerId,
          })
        ) {
          throw new Error('Lead access denied');
        }
        if (!context.staff && lead.phone !== context.user.phone) {
          throw new Error('Lead access denied');
        }
        await linkFloorPlanToLead(transaction, lead.id, plan.id);
        const linkedLead = await new LeadRepository(transaction).findById(lead.id);
        if (nextStatus === 'completed' && linkedLead?.enterpriseId && linkedLead.assignedTo) {
          await new AppointmentRepository(transaction).tryCreateOnSiteVisit({
            enterpriseId: linkedLead.enterpriseId,
            leadId: linkedLead.id,
            actorUserId: /^[1-9]\d*$/.test(context.user._id)
              ? BigInt(context.user._id)
              : null,
            eventKey: `on-site-floorplan:${linkedLead.id.toString()}:${plan.id.toString()}`,
          });
        }
        return { plan, becameCompleted, lead: linkedLead };
      }
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Floor plan not found' },
        { status: 404 }
      );
    }
    const plan = await persistAndAttachFloorPlanPreview(updated.plan);
    return NextResponse.json({ success: true, data: floorPlanToDto(plan) });
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
        const lead = await new LeadRepository(transaction).findByFloorPlanId(plan.id);
        if (lead && !canDeleteLeadFloorPlan(lead.status)) {
          throw Object.assign(
            new Error('线索已进入方案设计或后续阶段，不能删除量房记录'),
            { status: 409, code: 'FLOOR_PLAN_REQUIRED_FOR_LEAD_STAGE' }
          );
        }
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
    const message = getErrorMessage(error);
    return NextResponse.json(
      { success: false, error: message, code: (error as { code?: string })?.code },
      { status: (error as { status?: number })?.status || 500 }
    );
  }
}
