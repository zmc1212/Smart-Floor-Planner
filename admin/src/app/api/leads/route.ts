import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { AdminUser } from '@/models/AdminUser';
import { Enterprise } from '@/models/Enterprise';
import { User } from '@/models/User';
import { getTenantContext, getTenantFilter } from '@/lib/auth';
import { WeComService } from '@/lib/wecom';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid');
    
    // Support Mini-Program fetching leads by openid
    if (openid) {
      const user = await User.findOne({ openid });
      if (!user || user.role !== 'staff') {
        return NextResponse.json({ success: false, error: 'User is not a staff member' }, { status: 403 });
      }
      
      const staffMember = await AdminUser.findOne({ phone: user.phone });
      if (!staffMember) {
        return NextResponse.json({ success: false, error: 'Staff profile not found' }, { status: 404 });
      }

      // Fetch leads where staff is promoter or assigned
      const leads = await Lead.find({
        $or: [
          { promoterId: staffMember._id },
          { assignedTo: staffMember._id }
        ]
      })
      .populate({ path: 'floorPlanIds', select: 'name layoutData createdAt', strictPopulate: false })
      .populate('assignedTo', 'displayName role')
      .sort({ createdAt: -1 });

      return NextResponse.json({ success: true, data: leads });
    }

    // Default: Admin Dashboard Auth flow
    const context = await getTenantContext(request);
    if (!context) {
      console.log('Leads API: Unauthorized access attempt');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const status = searchParams.get('status');
    const source = searchParams.get('source');

    const basicQuery: any = {};
    if (status) basicQuery.status = status;
    if (source) basicQuery.source = source;

    // Apply tenant filter
    const tenantFilter = getTenantFilter(context, { staffField: 'assignedTo' });
    const query = { ...basicQuery, ...tenantFilter };

    console.log(`Leads API Trace: User=${context.username}, Role=${context.role}, EID=${context.enterpriseId}, Query=${JSON.stringify(query)}`);

    const leads = await Lead.find(query)
      .populate('assignedTo', 'displayName username')
      .populate('promoterId', 'displayName username')
      .sort({ createdAt: -1 });

    console.log(`Leads API Result: Found ${leads.length} leads`);

    return NextResponse.json({ success: true, data: leads });
  } catch (error: any) {
    console.error('Fetch leads error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const body = await request.json();
    
    // validate required fields
    if (!body.name || !body.phone) {
      return NextResponse.json({ success: false, error: 'Name and phone are required' }, { status: 400 });
    }

    // Workflow logic: Automatic Assignment
    let assignedTo = body.assignedTo;
    let promoterId = body.promoterId;
    let enterpriseId = body.enterpriseId || context?.enterpriseId;

    // 1. Handle mini-program submission: 'assignedTo' might be the referrer (staffId)
    // If the referrer is a salesperson, treat them as the promoter instead.
    if (assignedTo && !promoterId) {
      const staff = await AdminUser.findById(assignedTo);
      if (staff && staff.role === 'salesperson') {
        promoterId = staff._id;
        assignedTo = undefined; // Reset to find the designer
      }
    }

    // 2. Handle admin dashboard submission: if logged in user is a salesperson
    if (context && context.role === 'salesperson') {
      promoterId = context.userId;
      assignedTo = undefined; // Reset to find the designer
    }

    // 3. Find designer linked to this promoter
    if (promoterId && !assignedTo) {
      const designer = await AdminUser.findOne({ 
        role: 'designer',
        promoterIds: promoterId 
      });
      
      if (designer) {
        assignedTo = designer._id;
        console.log(`[Workflow] Auto-assigning lead ${body.name} to designer ${designer.displayName}`);
      }
    }

    // 4. Check if lead already exists (by phone) to merge floor plans
    let lead = await Lead.findOne({ phone: body.phone });

    if (lead) {
      // Merge: Update existing lead with new info and append floorPlanId
      if (body.floorPlanId && !lead.floorPlanIds.includes(body.floorPlanId)) {
        lead.floorPlanIds.push(body.floorPlanId);
      }
      if (body.communityName) lead.communityName = body.communityName;
      if (body.area) lead.area = body.area;
      if (body.stylePreference) lead.stylePreference = body.stylePreference;
      
      // Keep existing assignments unless missing
      if (!lead.promoterId) lead.promoterId = promoterId;
      if (!lead.assignedTo) lead.assignedTo = assignedTo;
      if (!lead.enterpriseId) lead.enterpriseId = enterpriseId;
      
      await lead.save();
    } else {
      // Create new lead
      const leadData = {
        ...body,
        floorPlanIds: body.floorPlanId ? [body.floorPlanId] : [],
        promoterId,
        assignedTo,
        enterpriseId,
        assignedAt: assignedTo ? new Date() : undefined
      };
      lead = await Lead.create(leadData);
    }

    // Workflow logic: WeCom Group Creation
    if (lead.enterpriseId && lead.promoterId && lead.assignedTo) {
      const enterprise = await Enterprise.findById(lead.enterpriseId);
      if (enterprise && enterprise.wecomConfig) {
        // Trigger WeCom group creation (fire and forget for this request)
        WeComService.createLeadGroup(
          enterprise,
          lead.name,
          lead.promoterId.toString(),
          lead.assignedTo.toString()
        ).then(groupId => {
          if (groupId) {
            Lead.findByIdAndUpdate(lead._id, { wecomGroupId: groupId }).exec();
            console.log(`[Workflow] Group created for lead ${lead.name}: ${groupId}`);
          }
        }).catch(err => {
          console.error('[Workflow] WeCom group creation background task failed:', err);
        });
      }
    }

    return NextResponse.json({ success: true, data: lead }, { status: 201 });
  } catch (error: any) {
    console.error('Create lead error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
