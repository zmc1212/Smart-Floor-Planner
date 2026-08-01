import { NextResponse } from 'next/server';
import {
  floorPlanToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  FloorPlanRepository,
  LeadRepository,
  UserRepository,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { linkFloorPlanToLead } from '@/lib/floorplan-lead-link';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';
import { isFormalSurveyLayout } from '@/lib/survey-graph';

interface FloorPlanRequestBody {
  name?: string;
  layoutData?: unknown;
  status?: 'draft' | 'completed';
  source?: 'manual';
  leadId?: string;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
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
    const plan = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const creatorId = await resolveCreatorId(transaction, context);
        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        const enterpriseId = context.enterpriseId
          ? parsePostgresId(context.enterpriseId, 'enterprise id')
          : null;
        const created = await new FloorPlanRepository(transaction).create({
          name: body.name?.trim() || '未命名户型',
          creatorId,
          staffId,
          enterpriseId,
          layoutData: body.layoutData as Record<string, unknown>,
          source: 'manual',
          status: planStatus,
          completedAt: planStatus === 'completed' ? new Date() : null,
        });
        if (!created) throw new Error('Failed to create floor plan');

        if (body.leadId) {
          const leadRepository = new LeadRepository(transaction);
          const lead = await leadRepository.findById(
            parsePostgresId(body.leadId, 'leadId')
          );
          if (!lead) throw new Error('Lead not found or access denied');
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
          await linkFloorPlanToLead(
            transaction,
            lead.id,
            created.id
          );
        }
        return created;
      }
    );
    return NextResponse.json(
      { success: true, data: floorPlanToDto(plan) },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const status = message.includes('access denied') ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
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
      formalOnly: true,
      page,
      limit,
    };

    const miniContext = await resolveMiniProgramContext(request);
    const result = miniContext
      ? await withMiniProgramPostgresTransaction(
          miniContext,
          (transaction) => {
            const staff = miniContext.staff;
            return new FloorPlanRepository(transaction).list({
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
            new FloorPlanRepository(transaction).list({
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
      data: result.rows.map(floorPlanToDto),
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
