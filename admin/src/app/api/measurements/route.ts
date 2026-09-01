import { NextResponse } from 'next/server';
import {
  measurementToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  DeviceRepository,
  FloorPlanRepository,
  LeadRepository,
  MeasurementRepository,
} from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { canRecordMiniProgramFloorPlanMeasurement } from '@/lib/floor-plan-access';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { resolveMeasurementAuditInput } from '@/lib/measurement-audit';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

const MEASUREMENT_TYPES = new Set([
  'length',
  'height',
  'area',
  'volume',
  'angle',
  'opening_offset',
  'opening_width',
]);
const MEASUREMENT_SOURCES = new Set(['ble', 'manual', 'system']);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get('page')) || 1, 1);
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit')) || 50, 1),
      100
    );
    const requestedOperatorId = parseOptionalPostgresId(
      searchParams.get('operatorId'),
      'operatorId'
    );
    const selfScoped =
      context.role === 'designer' ||
      context.role === 'salesperson' ||
      context.role === 'measurer';

    const result = await withAdminPostgresTransaction(
      context,
      (transaction) =>
        new MeasurementRepository(transaction).list({
          type: searchParams.get('type') || undefined,
          operatorId: selfScoped
            ? parsePostgresId(context.userId, 'userId')
            : requestedOperatorId ?? undefined,
          floorPlanId:
            parseOptionalPostgresId(
              searchParams.get('floorPlanId'),
              'floorPlanId'
            ) ?? undefined,
          deviceId: searchParams.get('deviceId') || undefined,
          page,
          limit,
        })
    );
    return NextResponse.json({
      success: true,
      data: result.rows.map(measurementToDto),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error: unknown) {
    console.error('Fetch measurements error:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (!body.floorPlanId || body.value === undefined || body.value === null) {
      return NextResponse.json(
        { success: false, error: 'floorPlanId and value are required' },
        { status: 400 }
      );
    }
    let floorPlanId: bigint;
    try {
      floorPlanId = parsePostgresId(body.floorPlanId, 'floorPlanId');
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid floorPlanId' },
        { status: 400 }
      );
    }
    const numericValue = Number(body.value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Measurement value must be a positive number',
        },
        { status: 400 }
      );
    }
    const type = body.type || 'length';
    const source = body.source || 'ble';
    if (!MEASUREMENT_TYPES.has(type) || !MEASUREMENT_SOURCES.has(source)) {
      return NextResponse.json(
        { success: false, error: 'Invalid measurement type or source' },
        { status: 400 }
      );
    }
    const measuredAt = body.measuredAt ? new Date(body.measuredAt) : new Date();
    if (Number.isNaN(measuredAt.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid measuredAt' },
        { status: 400 }
      );
    }

    const { auditId, metadata } = resolveMeasurementAuditInput(body);

    const creation = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const floorPlan = await new FloorPlanRepository(transaction).findById(
          floorPlanId
        );
        if (!floorPlan) throw new Error('FloorPlan not found');
        const linkedLead = await new LeadRepository(
          transaction
        ).findByFloorPlanId(floorPlan.id);

        const staffId = context.staff
          ? parsePostgresId(context.staff._id, 'staff id')
          : null;
        if (context.staff) {
          const staffEnterpriseId = context.staff.enterpriseId
            ? parsePostgresId(context.staff.enterpriseId, 'staff enterprise id')
            : null;
          if (
            staffEnterpriseId &&
            floorPlan.enterpriseId &&
            staffEnterpriseId !== floorPlan.enterpriseId
          ) {
            throw new Error(
              'Staff and floor plan belong to different enterprises'
            );
          }
        }
        if (
          !canRecordMiniProgramFloorPlanMeasurement(
            floorPlan,
            context,
            linkedLead
          )
        ) {
          throw new Error('Floor plan access denied');
        }

        let deviceId =
          typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
        if (!deviceId && staffId) {
          deviceId =
            (
              await new DeviceRepository(transaction).findLatestAssignedToUser(
                staffId
              )
            )?.code ?? '';
        }
        return new MeasurementRepository(transaction).createIdempotent({
          floorPlanId,
          auditId,
          operatorId: staffId,
          roomId:
            typeof body.roomId === 'string' ? body.roomId.trim() || null : null,
          roomName:
            typeof body.roomName === 'string'
              ? body.roomName.trim() || null
              : null,
          deviceId: deviceId || null,
          value: String(numericValue),
          unit: typeof body.unit === 'string' ? body.unit : 'meters',
          type,
          direction:
            typeof body.direction === 'string'
              ? body.direction.trim() || null
              : null,
          metadata,
          source,
          enterpriseId:
            floorPlan.enterpriseId ??
            (context.enterpriseId
              ? parsePostgresId(context.enterpriseId, 'enterprise id')
              : null),
          measuredAt,
        });
      }
    );
    if (!creation.measurement) {
      throw new Error('Failed to create measurement');
    }
    return NextResponse.json(
      {
        success: true,
        data: measurementToDto(creation.measurement),
        deduplicated: !creation.created,
      },
      { status: creation.created ? 201 : 200 }
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error('Create measurement error:', error);
    const status = (error as { status?: number })?.status ??
      (message === 'FloorPlan not found'
        ? 404
        : message.includes('access denied') ||
            message.includes('different enterprises')
          ? 403
          : 500);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
