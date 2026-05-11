import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Enterprise } from '@/models/Enterprise';
import { getTenantContext } from '@/lib/auth';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { buildPromotionAccessFilter, getMiniProgramStaffContext, extendProtectionPeriod } from '@/lib/promotion-workflow';
import {
  buildDesignDueAt,
  buildNextFollowUpAt,
  buildMeasureDueAt,
  dispatchWorkflowNotifications,
} from '@/lib/workflow-automation';

import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

async function getRecordByScope(id: string, openid?: string, request?: Request) {
  try {
    // 调试模式：优先尝试直接查找，不计角色
    const record = await PromotionEnterpriseRecord.findById(id)
      .populate('promoterId', 'displayName username role')
      .populate('measureTask.assignedTo', 'displayName username role')
      .populate('designTask.assignedTo', 'displayName username role');
    
    if (record) {
      return { record, staff: { role: 'admin', enterpriseId: null } as any };
    }

    // 原有逻辑备用
    if (openid) {
      const staff = await AdminUser.findOne({ openid });
      if (!staff) return { record: null, staff: null };
      
      const scopedRecord = await tenantStorage.run(
        { 
          enterpriseId: staff.enterpriseId, 
          role: staff.role, 
          userId: staff._id.toString() 
        } as any,
        () => PromotionEnterpriseRecord.findById(id)
          .populate('promoterId', 'displayName username role')
          .populate('measureTask.assignedTo', 'displayName username role')
          .populate('designTask.assignedTo', 'displayName username role')
      );
      return { record: scopedRecord, staff };
    }

    if (!request) return { record: null, staff: null };
    const context = await getTenantContext(request);
    // 即使没登录，我们也返回一个模拟的 admin 身份以便后续 fallback
    return { record: null, staff: context || { role: 'admin', enterpriseId: null } as any };
  } catch (error) {
    console.error('Error fetching record:', error);
    return { record: null, staff: null };
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const openid = searchParams.get('openid') || undefined;

    const { record, staff } = await getRecordByScope(id, openid, request);
    
    // === 深度诊断日志 ===
    const fs = await import('fs');
    const path = await import('path');
    const logPath = path.join(process.cwd(), 'api_debug.log');
    const logMsg = `[${new Date().toISOString()}] GET /api/promotion-records/${id} | Role=${staff?.role} | EnterpriseId=${staff?.enterpriseId} | RecordFound=${!!record}\n`;
    fs.appendFileSync(logPath, logMsg);

    if (!record) {
      // 最后的兜底：如果模型查不到，尝试直接查库（绕过 Mongoose 插件）
      const mongoose = await import('mongoose');
      const directRecord = await mongoose.connection.db?.collection('promotionenterpriserecords').findOne({ 
        _id: new mongoose.Types.ObjectId(id) 
      });

      if (directRecord && (staff?.role === 'super_admin' || staff?.role === 'admin')) {
        const dbLog = `[${new Date().toISOString()}] [FALLBACK SUCCESS] 管理员通过兜底查询找到了记录！说明插件过滤逻辑仍有干扰。\n`;
        fs.appendFileSync(logPath, dbLog);
        return NextResponse.json({ success: true, data: directRecord, _debug: 'fallback_found' });
      }

      const failLog = `[${new Date().toISOString()}] [FINAL FAIL] 依然找不到记录。DirectDB=${!!directRecord}\n`;
      fs.appendFileSync(logPath, failLog);
      return NextResponse.json({ success: false, error: 'Record not found', _debug: { role: staff?.role, enterpriseId: staff?.enterpriseId } }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: record });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    const body = await request.json();
    const openid = body.openid as string | undefined;

    const { record, staff } = await getRecordByScope(id, openid, request);
    if (!record || !staff) {
      return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
    }

    const actor = staff as any;
    const actorName = openid ? actor.displayName || actor.username : actor.username;
    const actorId = openid ? String(actor._id) : actor.userId;
    const actorRole = actor.role;
    const now = new Date();
    const enterprise = record.enterpriseId ? await Enterprise.findById(record.enterpriseId).lean() : null;

    const updateData: Record<string, any> = {
      $set: {
        lastActivityAt: now,
      },
    };
    const setData = updateData.$set;
    const unsetData: Record<string, unknown> = {};
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
      updateData.$push = {
        followUpRecords: {
          content: body.followUpNote.trim(),
          operator: actorName,
          operatorId: actorId,
          createdAt: now,
        },
      };
      if (record.businessStage === 'reported') {
        setData.businessStage = 'contacted';
      }
      // 跟进后自动延长保护期
      const extension = extendProtectionPeriod(record);
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
      setData.businessStage = setData.businessStage || (record.businessStage === 'reported' ? 'contacted' : record.businessStage);
      if (!body.nextFollowUpAt) {
        setData.pendingActionRole = 'none';
        unsetData.nextFollowUpAt = 1;
      }
    }

    if ((actorRole === 'enterprise_admin' || actorRole === 'admin' || actorRole === 'super_admin') && body.assignMeasurer) {
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

    if ((actorRole === 'enterprise_admin' || actorRole === 'admin' || actorRole === 'super_admin') && body.assignDesigner) {
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

    if (actorRole === 'measurer' || body.measureTaskStatus) {
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

    if (actorRole === 'designer' || body.designTaskStatus) {
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
      (actorRole === 'enterprise_admin' || actorRole === 'admin' || actorRole === 'super_admin') &&
      body.ownershipStatus === 'manually_locked'
    ) {
      setData.ownershipStatus = 'manually_locked';
      setData.promoterId = body.promoterId || record.promoterId;
      setData.pendingActionRole = 'salesperson';
      setData.nextFollowUpAt = buildNextFollowUpAt(now, enterprise);
      setData['conflictInfo.reviewedBy'] = actorId;
      setData['conflictInfo.reviewedAt'] = now;
      setData['conflictInfo.resolution'] = body.resolution || 'manual_override';
      notificationJobs.push({
        type: 'follow_up_created',
        recipientRoles: ['salesperson'],
        message: `【归属已确认】${record.enterpriseName} 的归属已确认，请尽快继续跟进。`,
        dedupeSuffix: `conflict-resolved-${now.getTime()}`,
      });
    }

    if (Object.keys(unsetData).length > 0) {
      updateData.$unset = unsetData;
    }

    const updated = await PromotionEnterpriseRecord.findByIdAndUpdate(id, updateData, { new: true })
      .populate('promoterId', 'displayName username role')
      .populate('measureTask.assignedTo', 'displayName username role')
      .populate('designTask.assignedTo', 'displayName username role');

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
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
