import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { getTenantContext, withTenantContext } from '@/lib/auth';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import {
  buildPromotionAccessFilter,
  buildPromotionDuplicateQuery,
  getMiniProgramStaffContext,
} from '@/lib/promotion-workflow';
import { buildNextFollowUpAt, dispatchWorkflowNotifications } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

function buildListQuery(searchParams: URLSearchParams) {
  const query: Record<string, unknown> = {};
  const stage = searchParams.get('stage');
  const ownershipStatus = searchParams.get('ownershipStatus');
  const search = searchParams.get('search');
  const view = searchParams.get('view');
  const conflictOnly = searchParams.get('conflictOnly') === 'true';

  if (stage && stage !== 'all') {
    query.businessStage = stage;
  }
  if (ownershipStatus && ownershipStatus !== 'all') {
    query.ownershipStatus = ownershipStatus;
  }
  if (conflictOnly || view === 'conflicts') {
    query.ownershipStatus = 'conflict_pending';
  }
  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i');
    query.$or = [{ enterpriseName: regex }, { contactPerson: regex }, { phone: regex }, { creditCode: regex }];
  }

  return query;
}

function getPopulateQuery(query: Record<string, unknown>) {
  return PromotionEnterpriseRecord.find(query)
    .populate('promoterId', 'displayName username role')
    .populate('measureTask.assignedTo', 'displayName username role')
    .populate('designTask.assignedTo', 'displayName username role')
    .populate('conflictInfo.reviewedBy', 'displayName username role');
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid');
    const baseQuery = buildListQuery(searchParams);

    if (openid) {
      const { staff } = await getMiniProgramStaffContext(openid);
      if (!staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }

      const query = { ...baseQuery, ...buildPromotionAccessFilter(staff) };
      const records = await getPopulateQuery(query).sort({ createdAt: -1 }).lean();
      return NextResponse.json({ success: true, data: records });
    }

    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return await withTenantContext(request, async () => {
      const query = { ...baseQuery };
      if (context.role === 'salesperson') {
        query.promoterId = context.userId;
      } else if (context.role === 'measurer') {
        query['measureTask.assignedTo'] = context.userId;
      } else if (context.role === 'designer') {
        query['designTask.assignedTo'] = context.userId;
      }

      const records = await getPopulateQuery(query).sort({ createdAt: -1 }).lean();
      return NextResponse.json({ success: true, data: records });
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    const openid = body.openid as string | undefined;

    let promoterId: string | undefined;
    let enterpriseId: string | undefined;
    let operatorName = 'System';

    if (openid) {
      const { staff } = await getMiniProgramStaffContext(openid);
      if (!staff || !['salesperson', 'enterprise_admin'].includes(staff.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      promoterId = body.promoterId || (staff.role === 'salesperson' ? staff._id.toString() : undefined);
      enterpriseId = staff.enterpriseId?.toString();
      operatorName = staff.displayName || staff.username;
    } else {
      const context = await getTenantContext(request);
      if (!context || !['salesperson', 'enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      promoterId = body.promoterId || (context.role === 'salesperson' ? context.userId : undefined);
      enterpriseId =
        context.role === 'admin' || context.role === 'super_admin'
          ? body.enterpriseId || context.enterpriseId || undefined
          : context.enterpriseId || undefined;
      operatorName = context.username;
    }

    if (!promoterId || !body.enterpriseName || !body.contactPerson || !body.phone) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const enterprise = enterpriseId ? await Enterprise.findById(enterpriseId).lean() : null;
    const duplicateQuery = buildPromotionDuplicateQuery({
      enterpriseId,
      creditCode: body.creditCode,
      enterpriseName: body.enterpriseName,
      phone: body.phone,
    });

    const existingRecords = await PromotionEnterpriseRecord.find(duplicateQuery).sort({ createdAt: 1 }).lean();
    const conflictingRecords = existingRecords.filter((item) => String(item.promoterId) !== String(promoterId));
    const sameOwnerRecord = existingRecords.find((item) => String(item.promoterId) === String(promoterId));
    const now = new Date();

    if (sameOwnerRecord && conflictingRecords.length === 0) {
      const updated = await PromotionEnterpriseRecord.findByIdAndUpdate(
        sameOwnerRecord._id,
        {
          $set: {
            enterpriseName: body.enterpriseName.trim(),
            creditCode: body.creditCode?.trim()?.toUpperCase() || undefined,
            contactPerson: body.contactPerson.trim(),
            phone: body.phone.trim(),
            city: body.city?.trim() || '',
            address: body.address?.trim() || '',
            industry: body.industry?.trim() || '',
            notes: body.notes?.trim() || sameOwnerRecord.notes,
            attachments: Array.isArray(body.attachments) ? body.attachments : sameOwnerRecord.attachments,
            location: body.location || sameOwnerRecord.location,
            lastActivityAt: now,
            pendingActionRole: sameOwnerRecord.ownershipStatus === 'conflict_pending' ? 'enterprise_admin' : 'salesperson',
            nextFollowUpAt:
              sameOwnerRecord.ownershipStatus === 'conflict_pending'
                ? undefined
                : sameOwnerRecord.nextFollowUpAt || buildNextFollowUpAt(now, enterprise),
          },
        },
        { new: true }
      );

      return NextResponse.json({ success: true, data: updated, created: false });
    }

    const created = await PromotionEnterpriseRecord.create({
      enterpriseName: body.enterpriseName.trim(),
      creditCode: body.creditCode?.trim()?.toUpperCase() || undefined,
      contactPerson: body.contactPerson.trim(),
      phone: body.phone.trim(),
      city: body.city?.trim() || '',
      address: body.address?.trim() || '',
      industry: body.industry?.trim() || '',
      sourceChannel: 'ground_promotion',
      promoterId,
      enterpriseId,
      ownershipStatus: conflictingRecords.length > 0 ? 'conflict_pending' : 'auto_locked',
      businessStage: 'reported',
      pendingActionRole: conflictingRecords.length > 0 ? 'enterprise_admin' : 'salesperson',
      nextFollowUpAt: conflictingRecords.length > 0 ? undefined : buildNextFollowUpAt(now, enterprise),
      lastActivityAt: now,
      notes: body.notes?.trim() || '',
      followUpRecords: body.notes
        ? [{ content: body.notes.trim(), operator: operatorName, operatorId: promoterId, createdAt: now }]
        : [],
      conflictInfo:
        conflictingRecords.length > 0
          ? {
              conflictReason: 'duplicate_report',
              conflictingRecordIds: conflictingRecords.map((item) => item._id),
            }
          : undefined,
      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      location: body.location || undefined,
    });

    const createdRecord = await PromotionEnterpriseRecord.findById(created._id).lean();
    if (createdRecord) {
      if (createdRecord.ownershipStatus === 'conflict_pending') {
        await dispatchWorkflowNotifications({
          record: createdRecord,
          notificationType: 'conflict_pending',
          recipientRoles: ['enterprise_admin'],
          message: `【归属冲突】${createdRecord.enterpriseName} 出现重复报备，请尽快确认归属。`,
          dedupeSuffix: `create-${createdRecord._id}`,
        });
      } else {
        await dispatchWorkflowNotifications({
          record: createdRecord,
          notificationType: 'follow_up_created',
          recipientRoles: ['salesperson'],
          message: `【新报备待跟进】${createdRecord.enterpriseName} 已报备成功，请在时限内完成首次联系。`,
          dedupeSuffix: `create-${createdRecord._id}`,
        });
      }
    }

    return NextResponse.json({ success: true, data: created, created: true }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
