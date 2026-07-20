import crypto from 'crypto';
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { Enterprise } from '@/models/Enterprise';
import { AiCreditLedger } from '@/models/AiCreditLedger';
import { AiGeneration } from '@/models/AiGeneration';
import { adjustAiCredits, ensureAiCreditAccount, grantAiCredits, serializeAiCreditAccount } from '@/lib/ai/credits';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { AI_ACTION_KEYS, type AiActionKey } from '@/lib/ai/provider-types';

type PopulatedOperator = { displayName?: string; username?: string };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterprise = await Enterprise.findById(id).select('name').lean();
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      const account = await ensureAiCreditAccount(id);
      const [ledger, tasks, policy] = await Promise.all([
        AiCreditLedger.find({ enterpriseId: id }).sort({ createdAt: -1 }).limit(30).populate('operatorId', 'displayName username').lean(),
        AiGeneration.find({ enterpriseId: id })
          .sort({ createdAt: -1 })
          .limit(30)
          .populate('operatorId', 'displayName username')
          .lean(),
        getEnterpriseAiPolicy(id),
      ]);
      return NextResponse.json({
        success: true,
        data: {
          enterprise: { id, name: enterprise.name },
          account: serializeAiCreditAccount(account),
          policy,
          ledger: ledger.map((item) => {
            const operator = item.operatorId as unknown as PopulatedOperator | undefined;
            return {
              id: String(item._id), operationId: item.operationId, type: item.type,
              amount: item.amount, balanceAfter: item.balanceAfter, frozenAfter: item.frozenAfter,
              status: item.status, note: item.note,
              generationId: item.generationId ? String(item.generationId) : undefined,
              operator: operator?.displayName || operator?.username || 'System', createdAt: item.createdAt,
            };
          }),
          tasks: tasks.map((task) => {
            const operator = task.operatorId as unknown as PopulatedOperator | undefined;
            return {
              id: String(task._id), mode: task.type, actionKey: task.actionKey,
              channel: task.channel, status: task.status,
              billingStatus: task.billing?.status, credits: task.billing?.price || 0,
              provider: task.provider, model: task.remoteModel, durationMs: task.durationMs,
              externalStatus: task.externalTask?.status,
              error: task.errorMessage,
              operator: operator?.displayName || operator?.username || 'Unknown', createdAt: task.createdAt,
            };
          }),
        },
      });
    });
  } catch (error) {
    console.error('[Admin AI Credits GET]', error);
    return NextResponse.json({ success: false, error: '读取 AI 点数账户失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const body = (await request.json()) as { enabledActionKeys?: AiActionKey[]; logicalModelTier?: 'standard' };
      if (!Array.isArray(body.enabledActionKeys) || body.enabledActionKeys.some((key) => !AI_ACTION_KEYS.includes(key))) {
        return NextResponse.json({ success: false, error: '企业 AI 功能策略无效' }, { status: 400 });
      }
      const enterprise = await Enterprise.findByIdAndUpdate(
        id,
        { $set: { 'aiPolicy.enabledActionKeys': [...new Set(body.enabledActionKeys)], 'aiPolicy.logicalModelTier': 'standard' } },
        { returnDocument: 'after' }
      );
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: await getEnterpriseAiPolicy(id) });
    });
  } catch (error) {
    console.error('[Admin AI Policy PATCH]', error);
    return NextResponse.json({ success: false, error: '保存企业 AI 策略失败' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const enterprise = await Enterprise.findById(id).select('_id').lean();
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      const body = (await request.json()) as { action?: 'grant' | 'adjust'; amount?: number; note?: string };
      if (!body.note?.trim()) {
        return NextResponse.json({ success: false, error: '请填写本次调整原因' }, { status: 400 });
      }
      const operationId = `admin:${id}:${crypto.randomUUID()}`;
      const result =
        body.action === 'grant'
          ? await grantAiCredits({
              enterpriseId: id,
              operatorId: context.userId,
              amount: Number(body.amount),
              operationId,
              note: body.note.trim(),
            })
          : body.action === 'adjust'
            ? await adjustAiCredits({
                enterpriseId: id,
                operatorId: context.userId,
                amount: Number(body.amount),
                operationId,
                note: body.note.trim(),
              })
            : null;
      if (!result) return NextResponse.json({ success: false, error: '不支持的操作' }, { status: 400 });
      return NextResponse.json({ success: true, data: serializeAiCreditAccount(result.account) });
    });
  } catch (error) {
    console.error('[Admin AI Credits POST]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '调整 AI 点数失败' },
      { status }
    );
  }
}
