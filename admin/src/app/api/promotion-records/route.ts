import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { Enterprise } from '@/models/Enterprise';
import { withPlatformB2BTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  buildListQuery,
  getPopulateQuery,
  buildPromotionDuplicateQuery,
  buildNextFollowUpAt,
} from '@/lib/promotion-workflow';
import { dispatchWorkflowNotifications } from '@/lib/workflow-automation';
import { notifyPlatformAdminOfNewReport } from '@/lib/wechat-notification';
import { tenantStorage } from '@/lib/tenant-context';
import { getPlatformPromotionConfig } from '@/lib/platform-promotion-config';
import { createPromotionTimelineEntry } from '@/lib/promotion-timeline';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const baseQuery = buildListQuery(searchParams);

    // Try Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext) {
      if (!mpContext.staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }

      return await tenantStorage.run(
        {
          enterpriseId: mpContext.staff.enterpriseId ? String(mpContext.staff.enterpriseId) : null,
          role: mpContext.staff.role,
          userId: String(mpContext.staff._id),
        },
        async () => {
          const query = { ...baseQuery };
          const records = await getPopulateQuery(query).sort({ createdAt: -1 }).lean();
          return NextResponse.json({ success: true, data: records });
        }
      );
    }

    return await withPlatformB2BTenantContext(request, async () => {
      const query = { ...baseQuery };
      const records = await getPopulateQuery(query).sort({ createdAt: -1 }).lean();
      return NextResponse.json({ success: true, data: records });
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    
    const mpContext = await resolveMiniProgramContext(request);
    if (mpContext) {
      if (!mpContext.staff) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
      }

      return await tenantStorage.run(
        {
          enterpriseId: mpContext.staff.enterpriseId ? String(mpContext.staff.enterpriseId) : null,
          role: mpContext.staff.role,
          userId: String(mpContext.staff._id),
        },
        async () => {
          return await handlePostInternal(body, mpContext.staff, null);
        }
      );
    }

    return await withPlatformB2BTenantContext(request, async (adminContext) => {
      return await handlePostInternal(body, null, adminContext);
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function handlePostInternal(body: any, mpStaff: any, adminContext: any) {
  let promoterId: string | undefined;
  let enterpriseId: string | undefined;
  let operatorName = 'System';

  if (mpStaff) {
    const staff = mpStaff;
    if (!['salesperson', 'enterprise_admin'].includes(staff.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    promoterId = body.promoterId || (staff.role === 'salesperson' ? staff._id.toString() : undefined);
    enterpriseId = staff.enterpriseId?.toString();
    operatorName = staff.displayName || staff.username;
  } else if (adminContext) {
    const context = adminContext;
    if (!['salesperson', 'enterprise_admin', 'admin', 'super_admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    promoterId = body.promoterId || (context.role === 'salesperson' ? context.userId : undefined);
    enterpriseId =
      context.role === 'admin' || context.role === 'super_admin'
        ? body.enterpriseId || undefined
        : context.enterpriseId || undefined;
    operatorName = context.username;
  }

  if (!promoterId || !body.enterpriseName || !body.contactPerson || !body.phone) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  const enterprise = enterpriseId ? await Enterprise.findById(enterpriseId).lean() : null;
  const duplicateQuery = buildPromotionDuplicateQuery({
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

  const config = await getPlatformPromotionConfig();
  const protectionExpiresAt = new Date(now.getTime() + config.protectionPeriodDays * 24 * 60 * 60 * 1000);

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
    poolStatus: conflictingRecords.length > 0 ? 'protected' : 'protected',
    protectionExpiresAt: conflictingRecords.length > 0 ? undefined : protectionExpiresAt,
    protectionExtendedCount: 0,
    notes: body.notes?.trim() || '',
    followUpRecords: [
      createPromotionTimelineEntry({
        type: 'report_created',
        content: '创建企业报备',
        operator: operatorName,
        operatorId: promoterId,
        operatorRole: mpStaff?.role || adminContext?.role || 'salesperson',
        createdAt: now,
      }),
      ...(body.notes
        ? [
            createPromotionTimelineEntry({
              type: 'note',
              content: body.notes.trim(),
              operator: operatorName,
              operatorId: promoterId,
              operatorRole: mpStaff?.role || adminContext?.role || 'salesperson',
              createdAt: now,
            }),
          ]
        : []),
    ],
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
        recipientRoles: ['salesperson', 'admin', 'super_admin'],
        message: `【新报备待跟进】${createdRecord.enterpriseName} 已报备成功，请在时限内完成首次联系。`,
        dedupeSuffix: `create-${createdRecord._id}`,
      });
      
      // Also specifically notify platform admins via WeChat
      await notifyPlatformAdminOfNewReport(createdRecord);
    }
  }

  return NextResponse.json({ success: true, data: created, created: true }, { status: 201 });
}
