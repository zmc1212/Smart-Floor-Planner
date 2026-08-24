import { NextResponse } from 'next/server';
import {
  floorPlanToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  FloorPlanRepository,
  type FloorPlanListOptions,
  LeadRepository,
  UserRepository,
  AppointmentRepository,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { persistAndAttachFloorPlanPreview } from '@/lib/floor-plan-preview';
import { canStaffMutateLeadSurvey } from '@/lib/lead-staff-access';
import { isFormalSurveyLayout } from '@/lib/survey-graph';

interface FloorPlanRequestBody {
  name?: string;
  layoutData?: unknown;
  status?: 'draft' | 'completed';
  source?: 'manual';
  leadId?: string;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function listFloorPlansWithDisplay(
  transaction: PostgresTransaction,
  options: FloorPlanListOptions
) {
  const result = await new FloorPlanRepository(transaction).list(options);
  const leadsByPlan = await new LeadRepository(transaction).findByFloorPlanIds(
    result.rows.map((plan) => plan.id)
  );
  return {
    data: result.rows.map((plan) => {
      const lead = leadsByPlan.get(plan.id);
      const measurementSequence = lead?.floorPlanRecords.find(
        (record) => record.id === plan.id
      )?.measurementSequence;
      return floorPlanToDto(plan, { lead, measurementSequence });
    }),
    total: result.total,
  };
}

async function resolveCreatorId(
  transaction: PostgresTransaction,
  context: NonNullable<Awaited<ReturnType<typeof resolveMiniProgramContext>>>
) {
  const repository = new UserRepository(transaction);
  if (/^[1-9]\d*$/.test(context.user._id)) {
    const id = parsePostgresId(context.user._id, 'user id');
    if (await repository.findById(id)) return id;
  }
  const phone = context.staff?.phone || context.user.phone;
  const enterpriseId = context.enterpriseId
    ? parsePostgresId(context.enterpriseId, 'enterprise id')
    : null;
  const existing = phone
    ? await repository.findByPhoneInEnterprise(phone, enterpriseId)
    : null;
  if (existing) return existing.id;
  if (!context.staff) throw new Error('Mini Program user not found');
  const created = await repository.create({
    enterpriseId,
    role: 'staff',
    nickname: context.staff.displayName || context.staff.username,
    phone: phone || null,
    openid: context.staff.openid || null,
  });
  return created.id;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FloorPlanRequestBody;
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!body.layoutData) {
      return NextResponse.json(
        { success: false, error: 'Missing layoutData' },
        { status: 400 }
      );
    }
    if (!isFormalSurveyLayout(body.layoutData)) {
      return NextResponse.json(
        {
          success: false,
          error: 'layoutData must use the formal surveyGraph contract',
        },
        { status: 400 }
      );
    }
    const planStatus = body.status || 'completed';
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || '';
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return NextResponse.json(
        { success: false, error: 'Idempotency-Key is too long' },
        { status: 400 }
      );
    }
    const createdResult = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const creatorId = await resolveCreatorId(transaction, context);
        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        const enterpriseId = context.enterpriseId
          ? parsePostgresId(context.enterpriseId, 'enterprise id')
          : null;
        const floorPlanRepository = new FloorPlanRepository(transaction);
        if (idempotencyKey) {
          const existing = await floorPlanRepository.findByCreateIdempotencyKey(
            idempotencyKey
          );
          if (existing) {
            const sameEnterprise = existing.enterpriseId === enterpriseId;
            if (existing.creatorId !== creatorId || !sameEnterprise) {
              throw Object.assign(
                new Error('Idempotency-Key has already been used'),
                { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }
              );
            }
            return {
              plan: existing,
              lead: await new LeadRepository(transaction).findByFloorPlanId(existing.id),
              created: false,
            };
          }
        }
        const createdResult = await floorPlanRepository.createIdempotent({
          name: body.name?.trim() || '未命名户型',
          creatorId,
          staffId,
          enterpriseId,
          layoutData: body.layoutData as Record<string, unknown>,
          source: 'manual',
          status: planStatus,
          completedAt: planStatus === 'completed' ? new Date() : null,
          ...(idempotencyKey ? { createIdempotencyKey: idempotencyKey } : {}),
        });
        const created = createdResult.plan;
        if (!created) throw new Error('Failed to create floor plan');
        if (!createdResult.created) {
          const sameEnterprise = created.enterpriseId === enterpriseId;
          if (created.creatorId !== creatorId || !sameEnterprise) {
            throw Object.assign(
              new Error('Idempotency-Key has already been used'),
              { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }
            );
          }
          return {
            plan: created,
            lead: await new LeadRepository(transaction).findByFloorPlanId(created.id),
            created: false,
          };
        }

        let linkedLead = null;
        if (body.leadId) {
          const leadRepository = new LeadRepository(transaction);
          const lead = await leadRepository.findById(
            parsePostgresId(body.leadId, 'leadId')
          );
          if (!lead) throw new Error('Lead not found or access denied');
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
          await linkFloorPlanToLead(
            transaction,
            lead.id,
            created.id
          );
          linkedLead = await leadRepository.findById(lead.id);
          if (planStatus === 'completed' && linkedLead?.enterpriseId && linkedLead.assignedTo) {
            await new AppointmentRepository(transaction).tryCreateOnSiteVisit({
              enterpriseId: linkedLead.enterpriseId,
              leadId: linkedLead.id,
              actorUserId: creatorId,
              eventKey: `on-site-floorplan:${linkedLead.id.toString()}:${created.id.toString()}`,
            });
          }
        }
        return { plan: created, lead: linkedLead, created: true };
      }
    );
    const plan = await persistAndAttachFloorPlanPreview(createdResult.plan);
    return NextResponse.json(
      {
        success: true,
        data: floorPlanToDto(plan, {
          lead: createdResult.lead,
          measurementSequence: createdResult.lead?.floorPlanRecords.find(
            (record) => record.id === plan.id
          )?.measurementSequence,
        }),
      },
      { status: createdResult.created ? 201 : 200 }
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const status = (error as { status?: number })?.status
      || (message.includes('access denied') ? 403 : 500);
    return NextResponse.json(
      { success: false, error: message, code: (error as { code?: string })?.code },
      { status }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get('page')) || 1, 1);
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit')) || 20, 1),
      50
    );
    const baseOptions = {
      phone: searchParams.get('phone') || undefined,
      search: searchParams.get('search') || undefined,
      status: searchParams.get('status') || undefined,
      formalOnly: true,
      page,
      limit,
    };

    const miniContext = await resolveMiniProgramContext(request);
    const result = miniContext
      ? await withMiniProgramPostgresTransaction(
          miniContext,
          async (transaction) => {
            const staff = miniContext.staff;
            return listFloorPlansWithDisplay(transaction, {
              ...baseOptions,
              staffId:
                staff && staff.role !== 'enterprise_admin'
                  ? parsePostgresId(staff._id, 'staff id')
                  : undefined,
              creatorId: !staff
                ? parsePostgresId(miniContext.user._id, 'user id')
                : undefined,
            });
          }
        )
      : await (async () => {
          const adminContext = await getTenantContext(request);
          if (!adminContext) return null;
          return withAdminPostgresTransaction(adminContext, (transaction) =>
            listFloorPlansWithDisplay(transaction, {
              ...baseOptions,
              staffId:
                adminContext.role === 'designer' ||
                adminContext.role === 'salesperson'
                  ? parsePostgresId(adminContext.userId, 'userId')
                  : undefined,
            })
          );
        })();

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
