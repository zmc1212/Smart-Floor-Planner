import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser } from '@/models/AdminUser';
import { getPlatformB2BTenantContext, getTenantContext } from '@/lib/auth';
import {
  extendProtectionPeriod,
  getPromotionRecordByIdQuery,
} from '@/lib/promotion-workflow';
import {
  buildDesignDueAt,
  buildNextFollowUpAt,
  buildMeasureDueAt,
  dispatchWorkflowNotifications,
} from '@/lib/workflow-automation';
import { tenantStorage } from '@/lib/tenant-context';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { createPromotionTimelineEntry, resolveOperatorName } from '@/lib/promotion-timeline';
import { getPlatformPromotionConfig } from '@/lib/platform-promotion-config';

export const dynamic = 'force-dynamic';

type RecordActor = {
  id: string;
  role: string;
  name: string;
  enterpriseId?: string | null;
};

async function getScopedRecord(request: Request, id: string) {
  const mpContext = await resolveMiniProgramContext(request);
  if (mpContext?.staff) {
    const actor: RecordActor = {
      id: String(mpContext.staff._id),
      role: mpContext.staff.role,
      name: resolveOperatorName(mpContext.staff),
      enterpriseId: mpContext.staff.enterpriseId ? String(mpContext.staff.enterpriseId) : null,
    };

    const record = await tenantStorage.run(
      {
        enterpriseId: actor.enterpriseId || null,
        role: actor.role,
        userId: actor.id,
      },
      () => getPromotionRecordByIdQuery(id)
    );

    return { record, actor };
  }

  const context = await getTenantContext(request);
  if (!context) {
    return { record: null, actor: null };
  }

  const b2bContext = getPlatformB2BTenantContext(context);
  const actor: RecordActor = {
    id: b2bContext.userId,
    role: b2bContext.role,
    name: b2bContext.username,
    enterpriseId: b2bContext.enterpriseId,
  };

  const record = await tenantStorage.run(
    {
      enterpriseId: b2bContext.enterpriseId,
      role: b2bContext.role,
      userId: b2bContext.userId,
      username: b2bContext.username,
    },
    () => getPromotionRecordByIdQuery(id)
  );

  return { record, actor };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const { record, actor } = await getScopedRecord(request, id);

    if (!actor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!record) {
      return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: record });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();
    const { record, actor } = await getScopedRecord(request, id);

    if (!actor) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!record) {
      return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
    }

    const now = new Date();
    const enterprise = record.enterpriseId ? await Enterprise.findById(record.enterpriseId).lean() : null;
    const platformPromotionConfig = await getPlatformPromotionConfig();

    const updateData: Record<string, unknown> = {
      $set: {
        lastActivityAt: now,
      },
    };
    const setData = updateData.$set as Record<string, unknown>;
    const unsetData: Record<string, unknown> = {};
    const pushEntries: Array<Record<string, unknown>> = [];
    const notificationJobs: Array<{
      type: 'follow_up_created' | 'measure_assigned' | 'measure_submitted' | 'design_assigned' | 'design_completed' | 'conflict_pending';
      recipientRoles: string[];
      message: string;
      dedupeSuffix: string;
    }> = [];

    if (body.businessStage) {
      setData.businessStage = body.businessStage;
      if (body.businessStage === 'closed_lost') {
        setData.pendingActionRole = 'none';
        unsetData.nextFollowUpAt = 1;
      }
      if (body.businessStage === 'contacted' && !body.nextFollowUpAt) {
        setData.pendingActionRole = 'salesperson';
      }
    }

    if (body.followUpNote?.trim()) {
      pushEntries.push(
        createPromotionTimelineEntry({
          type: 'follow_up',
          content: body.followUpNote.trim(),
          operator: actor.name,
          operatorId: actor.id,
          operatorRole: actor.role,
          createdAt: now,
        })
      );
      if (record.businessStage === 'reported') {
        setData.businessStage = 'contacted';
      }
      const extension = await extendProtectionPeriod(record);
      if (extension) {
        setData.protectionExpiresAt = extension.protectionExpiresAt;
        setData.protectionExtendedCount = extension.protectionExtendedCount;
      }
    }

    if (body.nextFollowUpAt !== undefined) {
      if (body.nextFollowUpAt) {
        const nextFollowUpAt = new Date(body.nextFollowUpAt);
        if (!Number.isNaN(nextFollowUpAt.getTime())) {
          setData.nextFollowUpAt = nextFollowUpAt;
          setData.pendingActionRole = 'salesperson';
        }
      } else {
        unsetData.nextFollowUpAt = 1;
      }
    }

    if (body.followUpCompleted) {
      setData.businessStage =
        setData.businessStage || (record.businessStage === 'reported' ? 'contacted' : record.businessStage);
      if (!body.nextFollowUpAt) {
        setData.pendingActionRole = 'none';
        unsetData.nextFollowUpAt = 1;
      }
    }

    if ((actor.role === 'enterprise_admin' || actor.role === 'admin' || actor.role === 'super_admin') && body.assignMeasurer) {
      setData['measureTask.assignedTo'] = body.assignMeasurer;
      setData['measureTask.status'] = 'assigned';
      setData['measureTask.assignedAt'] = now;
      setData['measureTask.dueAt'] = buildMeasureDueAt(now, enterprise);
      setData.businessStage = 'measuring';
      setData.pendingActionRole = 'measurer';
      unsetData['measureTask.lastReminderAt'] = 1;
      unsetData.nextFollowUpAt = 1;
      notificationJobs.push({
        type: 'measure_assigned',
        recipientRoles: ['measurer'],
        message: `【测量任务】${record.enterpriseName} 已分配给你，请按时完成测量。`,
        dedupeSuffix: `measure-assign-${now.getTime()}`,
      });
    }

    if ((actor.role === 'enterprise_admin' || actor.role === 'admin' || actor.role === 'super_admin') && body.assignDesigner) {
      setData['designTask.assignedTo'] = body.assignDesigner;
      setData['designTask.status'] = 'assigned';
      setData['designTask.assignedAt'] = now;
      setData['designTask.dueAt'] = buildDesignDueAt(now, enterprise);
      setData.businessStage = 'designing';
      setData.pendingActionRole = 'designer';
      unsetData['designTask.lastReminderAt'] = 1;
      notificationJobs.push({
        type: 'design_assigned',
        recipientRoles: ['designer'],
        message: `【设计任务】${record.enterpriseName} 已分配给你，请按时推进设计。`,
        dedupeSuffix: `design-assign-${now.getTime()}`,
      });
    }

    if (actor.role === 'measurer' || body.measureTaskStatus) {
      if (body.measureTaskStatus === 'accepted') {
        setData['measureTask.status'] = 'accepted';
        setData['measureTask.acceptedAt'] = now;
        setData.businessStage = 'measuring';
        setData.pendingActionRole = 'measurer';
      }
      if (body.measureTaskStatus === 'submitted') {
        setData['measureTask.status'] = 'submitted';
        setData['measureTask.submittedAt'] = now;
        setData['measureTask.resultSummary'] = body.measureResultSummary?.trim() || '';
        setData.businessStage = 'measuring';
        setData.pendingActionRole = 'enterprise_admin';
        notificationJobs.push({
          type: 'measure_submitted',
          recipientRoles: ['enterprise_admin'],
          message: `【测量结果待处理】${record.enterpriseName} 已提交测量结果，请尽快分配设计师。`,
          dedupeSuffix: `measure-submitted-${now.getTime()}`,
        });
      }
    }

    if (actor.role === 'designer' || body.designTaskStatus) {
      if (body.designTaskStatus === 'in_progress') {
        setData['designTask.status'] = 'in_progress';
        setData['designTask.latestNote'] = body.designNote?.trim() || '';
        setData.businessStage = 'designing';
        setData.pendingActionRole = 'designer';
      }
      if (body.designTaskStatus === 'completed') {
        setData['designTask.status'] = 'completed';
        setData['designTask.completedAt'] = now;
        setData['designTask.latestNote'] = body.designNote?.trim() || '';
        setData.businessStage = 'quoted';
        setData.pendingActionRole = 'salesperson';
        setData.nextFollowUpAt = buildNextFollowUpAt(now, enterprise);
        notificationJobs.push({
          type: 'design_completed',
          recipientRoles: ['salesperson', 'enterprise_admin'],
          message: `【设计已完成】${record.enterpriseName} 已完成设计，请尽快推进报价和成交跟进。`,
          dedupeSuffix: `design-completed-${now.getTime()}`,
        });
      }
    }

    if (
      (actor.role === 'enterprise_admin' || actor.role === 'admin' || actor.role === 'super_admin') &&
      body.ownershipStatus === 'manually_locked' &&
      body.promoterId
    ) {
      const targetPromoter = await AdminUser.findOne({
        _id: body.promoterId,
        role: 'salesperson',
        status: 'active',
      }).select('displayName username role');

      if (!targetPromoter) {
        return NextResponse.json({ success: false, error: 'Target salesperson not found' }, { status: 400 });
      }

      const protectionExpiresAt = new Date(
        now.getTime() + platformPromotionConfig.protectionPeriodDays * 24 * 60 * 60 * 1000
      );
      setData.ownershipStatus = 'manually_locked';
      setData.promoterId = body.promoterId;
      setData.poolStatus = 'protected';
      setData.pendingActionRole = 'salesperson';
      setData.protectionExpiresAt = protectionExpiresAt;
      setData.protectionExtendedCount = 0;
      setData.businessStage = record.businessStage === 'closed_lost' ? 'reported' : record.businessStage;
      setData.nextFollowUpAt = buildNextFollowUpAt(now, enterprise);
      setData['conflictInfo.reviewedBy'] = actor.id;
      setData['conflictInfo.reviewedAt'] = now;
      setData['conflictInfo.resolution'] = body.resolution || 'manual_override';
      unsetData.claimRequest = 1;
      pushEntries.push(
        createPromotionTimelineEntry({
          type: 'ownership_assigned',
          content: `${actor.name} 指派渠道地推：${resolveOperatorName(targetPromoter)}`,
          operator: actor.name,
          operatorId: actor.id,
          operatorRole: actor.role,
          metadata: {
            promoterId: String(targetPromoter._id),
          },
          createdAt: now,
        })
      );
      notificationJobs.push({
        type: 'follow_up_created',
        recipientRoles: ['salesperson'],
        message: `【归属已确认】${record.enterpriseName} 的归属已确认，请尽快继续跟进。`,
        dedupeSuffix: `ownership-assigned-${now.getTime()}`,
      });
    }

    if (pushEntries.length > 0) {
      updateData.$push = {
        followUpRecords: {
          $each: pushEntries,
        },
      };
    }

    if (Object.keys(unsetData).length > 0) {
      updateData.$unset = unsetData;
    }

    await record.updateOne(updateData);
    const updated = await getPromotionRecordByIdQuery(id);

    for (const job of notificationJobs) {
      await dispatchWorkflowNotifications({
        record: updated,
        notificationType: job.type,
        recipientRoles: job.recipientRoles,
        message: job.message,
        dedupeSuffix: job.dedupeSuffix,
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
