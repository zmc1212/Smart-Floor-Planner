import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { AdminUser } from '@/models/AdminUser';
import { Device } from '@/models/Device';
import { FloorPlan } from '@/models/FloorPlan';
import { Measurement } from '@/models/Measurement';
import { User } from '@/models/User';

export const dynamic = 'force-dynamic';

function normalizeId(value: unknown) {
  if (!value) return undefined;
  const id = typeof value === 'object' && value !== null && '_id' in value ? (value as any)._id : value;
  return mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : undefined;
}

async function resolveStaffByOpenid(openid: string) {
  const user = await User.findOne({ openid });
  if (!user) return { user: null, staff: null };

  const staff = await AdminUser.findOne({
    status: 'active',
    $or: [{ openid }, ...(user.phone ? [{ phone: user.phone }] : [])],
  });

  return { user, staff };
}

function buildTenantMeasurementQuery(context: Awaited<ReturnType<typeof getTenantContext>>) {
  const query: Record<string, unknown> = {};
  if (!context) return query;

  if (context.enterpriseId) {
    query.enterpriseId = new mongoose.Types.ObjectId(context.enterpriseId);
  }

  if (context.role === 'designer' || context.role === 'salesperson') {
    query.operatorId = new mongoose.Types.ObjectId(context.userId);
  }

  return query;
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await withTenantContext(request, async () => {
      const { searchParams } = new URL(request.url);
      const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 100);
      const skip = (page - 1) * limit;
      const type = searchParams.get('type');
      const operatorId = normalizeId(searchParams.get('operatorId'));
      const floorPlanId = normalizeId(searchParams.get('floorPlanId'));
      const deviceId = searchParams.get('deviceId');

      const query: Record<string, unknown> = buildTenantMeasurementQuery(context);
      if (type && type !== 'all') query.type = type;
      if (floorPlanId) query.floorPlanId = floorPlanId;
      if (deviceId) query.deviceId = deviceId;

      if (operatorId && (context.role === 'super_admin' || context.role === 'admin' || context.role === 'enterprise_admin')) {
        query.operatorId = operatorId;
      }

      const [items, total] = await Promise.all([
        Measurement.find(query)
          .sort({ measuredAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('operatorId', 'displayName username role')
          .populate('enterpriseId', 'name')
          .populate('floorPlanId', 'name status')
          .lean(),
        Measurement.countDocuments(query),
      ]);

      return NextResponse.json({
        success: true,
        data: items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    });
  } catch (error: any) {
    console.error('Fetch measurements error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    const { openid, floorPlanId, roomId, roomName, deviceId, value, unit, type, direction, source, measuredAt } = body;

    if (!openid || !floorPlanId || value === undefined || value === null) {
      return NextResponse.json({ success: false, error: 'openid, floorPlanId and value are required' }, { status: 400 });
    }

    if (!mongoose.Types.ObjectId.isValid(String(floorPlanId))) {
      return NextResponse.json({ success: false, error: 'Invalid floorPlanId' }, { status: 400 });
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return NextResponse.json({ success: false, error: 'Measurement value must be a positive number' }, { status: 400 });
    }

    const [{ user, staff }, floorPlan] = await Promise.all([
      resolveStaffByOpenid(openid),
      FloorPlan.findById(floorPlanId),
    ]);

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (!floorPlan) {
      return NextResponse.json({ success: false, error: 'FloorPlan not found' }, { status: 404 });
    }

    const floorPlanEnterpriseId = normalizeId((floorPlan as any).enterpriseId);
    const staffEnterpriseId = normalizeId((staff as any)?.enterpriseId);
    const enterpriseId = floorPlanEnterpriseId || staffEnterpriseId;

    if (staffEnterpriseId && floorPlanEnterpriseId && String(staffEnterpriseId) !== String(floorPlanEnterpriseId)) {
      return NextResponse.json({ success: false, error: 'Staff and floor plan belong to different enterprises' }, { status: 403 });
    }

    let normalizedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : undefined;
    if (!normalizedDeviceId && staff?._id) {
      const assignedDevice = await Device.findOne({ assignedUserId: staff._id }).sort({ updatedAt: -1 }).lean();
      normalizedDeviceId = assignedDevice?.code;
    }

    const measurement = await Measurement.create({
      floorPlanId: floorPlan._id,
      operatorId: staff?._id,
      roomId,
      roomName,
      deviceId: normalizedDeviceId,
      value: numericValue,
      unit: unit || 'meters',
      type: type || 'length',
      direction,
      source: source || 'ble',
      enterpriseId,
      measuredAt: measuredAt ? new Date(measuredAt) : new Date(),
    });

    return NextResponse.json({ success: true, data: measurement }, { status: 201 });
  } catch (error: any) {
    console.error('Create measurement error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
