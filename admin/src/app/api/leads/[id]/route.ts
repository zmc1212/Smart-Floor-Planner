import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { FloorPlan } from '@/models/FloorPlan';
import { AdminUser } from '@/models/AdminUser';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const lead = await Lead.findById(id)
      .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt status source externalSource', strictPopulate: false })
      .populate({ path: 'primaryFloorPlanId', select: 'name layoutData createdAt status source externalSource', strictPopulate: false })
      .populate('assignedTo', 'displayName role');

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: lead });
  } catch (error: any) {
    console.error('Fetch lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();
    const context = await resolveMiniProgramContext(request);

    // Support Mini Program auth via JWT or openid
    if (context?.staff || body.openid) {
      let staff = context?.staff;
      
      // Fallback for legacy requests without JWT
      if (!staff && body.openid) {
        const { User } = require('@/models/User');
        const { AdminUser } = require('@/models/AdminUser');
        const user = await User.findOne({ openid: body.openid });
        if (user && user.role === 'staff') {
          staff = await AdminUser.findOne({ phone: user.phone });
        }
      }

      if (staff) {
        const tenantFilter = {
          $or: [
            { promoterId: staff._id },
            { assignedTo: staff._id }
          ]
        };

        // 继续原有的更新逻辑
        // Fetch current lead to determine status transition
        const currentLead = await Lead.findOne({ _id: id, ...tenantFilter });
        if (!currentLead) {
          return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
        }

        if (body.assignedTo) {
          body.assignedAt = new Date();
        }

        let updateOps: any = { ...body };
        let updateDoc: any = {};

        if (updateOps.openid) delete updateOps.openid;

        // --- Automation Logic Start ---
        // 1. If assigned to a designer, move to 'assigned' status
        if (body.assignedTo) {
          const assignedUser = await AdminUser.findById(body.assignedTo);
          if (assignedUser && assignedUser.role === 'designer') {
            updateOps.status = 'assigned';
          }
        }

        // 2. If floorPlanId is being added, move to 'measuring' if current status is 'new'
        if (body.floorPlanId) {
          delete updateOps.floorPlanId;
          updateDoc.$addToSet = { floorPlanIds: body.floorPlanId };
          updateOps.primaryFloorPlanId = body.floorPlanId;
          
          if (currentLead.status === 'new') {
            updateOps.status = 'measuring';
          }
        }
        // --- Automation Logic End ---

        if (Object.keys(updateOps).length > 0) {
          updateDoc.$set = updateOps;
        }

        const lead = await Lead.findOneAndUpdate(
          { _id: id, ...tenantFilter },
          Object.keys(updateDoc).length > 0 ? updateDoc : body,
          { new: true, runValidators: true }
        );

        if (!lead) {
          return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: lead });
      } else {
        return NextResponse.json({ success: false, error: 'Staff profile not found or Unauthorized' }, { status: 403 });
      }
    }

    // Admin Dashboard Context - 使用新的租户上下文包装器
    else {
      try {
        return await withTenantContext(request, async () => {
          // 插件会自动注入租户过滤
          if (body.assignedTo) {
            body.assignedAt = new Date();
          }

          // Fetch current lead to determine status transition
          const currentLead = await Lead.findById(id);
          if (!currentLead) {
            return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
          }

          let updateOps: any = { ...body };
          let updateDoc: any = {};

          // --- Automation Logic Start ---
          // 1. If assigned to a designer, move to 'assigned' status
          if (body.assignedTo) {
            const assignedUser = await AdminUser.findById(body.assignedTo);
            if (assignedUser && assignedUser.role === 'designer') {
              updateOps.status = 'assigned';
            }
          }

          // 2. If floorPlanId is being added, move to 'measuring' if current status is 'new'
          if (body.floorPlanId) {
            delete updateOps.floorPlanId;
            updateDoc.$addToSet = { floorPlanIds: body.floorPlanId };
            updateOps.primaryFloorPlanId = body.floorPlanId;
            
            if (currentLead.status === 'new') {
              updateOps.status = 'measuring';
            }
          }
          // --- Automation Logic End ---

          if (Object.keys(updateOps).length > 0) {
            updateDoc.$set = updateOps;
          }

          const lead = await Lead.findOneAndUpdate(
            { _id: id }, // 插件自动注入租户过滤
            Object.keys(updateDoc).length > 0 ? updateDoc : body,
            { new: true, runValidators: true }
          );

          if (!lead) {
            return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
          }

          return NextResponse.json({ success: true, data: lead });
        });
      } catch (error: any) {
        if (error.message === 'Unauthorized') {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Update lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();

    try {
      return await withTenantContext(request, async () => {
        const { id } = await params;

        // 插件会自动注入租户过滤，无需手动处理
        const lead = await Lead.findOneAndDelete({ _id: id });

        if (!lead) {
          return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
        }

        // 级联删除关联的户型图数据
        if (lead.floorPlanIds && lead.floorPlanIds.length > 0) {
          console.log(`[Cleanup] Deleting ${lead.floorPlanIds.length} associated floor plans for lead ${lead.name}`);
          await FloorPlan.deleteMany({ _id: { $in: lead.floorPlanIds } });
        }

        return NextResponse.json({ success: true, data: {} });
      });
    } catch (error: any) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Delete lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
