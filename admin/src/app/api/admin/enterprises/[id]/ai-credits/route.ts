import crypto from 'crypto';
import { NextResponse } from 'next/server';
import {
  AiCreationRepository,
  AiCreditRepository,
  EnterpriseRepository,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';
import { adjustAiCredits, ensureAiCreditAccount, grantAiCredits, serializeAiCreditAccount } from '@/lib/ai/credits';
import { getEnterpriseAiPolicy } from '@/lib/ai/enterprise-policy';
import { AI_ACTION_KEYS, type AiActionKey } from '@/lib/ai/provider-types';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterprise id');
      const enterprise = await withPlatformTransaction((transaction) =>
        new EnterpriseRepository(transaction).findById(enterpriseId)
      );
      if (!enterprise) return NextResponse.json({ success: false, error: 'Enterprise not found' }, { status: 404 });
      const account = await ensureAiCreditAccount(id);
      const [ledger, tasks, policy] = await Promise.all([
        withPlatformTransaction((transaction) =>
          new AiCreditRepository(transaction).listWithOperators(enterpriseId)
        ),
        withPlatformTransaction((transaction) =>
          new AiCreationRepository(transaction).listEnterpriseGenerationsWithOperators(enterpriseId)
        ),
        getEnterpriseAiPolicy(id),
      ]);
      return NextResponse.json({
        success: true,
        data: {
          enterprise: { id, name: enterprise.name },
          account: serializeAiCreditAccount(account),
          policy,
          ledger: ledger.map((item) => {
            const record = item.ledger;
            return {
              id: String(record.id), operationId: record.operationId, type: record.type,
              amount: Number(record.amount), balanceAfter: record.balanceAfter === null ? null : Number(record.balanceAfter),
              frozenAfter: record.frozenAfter === null ? null : Number(record.frozenAfter),
              status: record.status, note: record.note,
              generationId: record.generationId ? String(record.generationId) : undefined,
              operator: item.operatorDisplayName || item.operatorUsername || 'System', createdAt: record.createdAt,
            };
          }),
          tasks: tasks.map((task) => {
            const generation = task.generation;
            const billing = generation.billing || {};
            const externalTask = generation.externalTask || {};
            return {
              id: String(generation.id), mode: generation.type, actionKey: generation.actionKey,
              channel: generation.channel, status: generation.status,
              billingStatus: billing.status, credits: Number(billing.price || 0),
              provider: generation.provider, model: task.attemptRemoteModel || generation.logicalModelKey,
              durationMs: generation.durationMs, externalStatus: externalTask.status,
              error: generation.errorMessage,
              operator: task.operatorDisplayName || task.operatorUsername || 'Unknown',
              createdAt: generation.createdAt,
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
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterprise id');
      const body = (await request.json()) as { enabledActionKeys?: AiActionKey[]; logicalModelTier?: 'standard' };
      if (!Array.isArray(body.enabledActionKeys) || body.enabledActionKeys.some((key) => !AI_ACTION_KEYS.includes(key))) {
        return NextResponse.json({ success: false, error: '企业 AI 功能策略无效' }, { status: 400 });
      }
      const enterprise = await withPlatformTransaction((transaction) =>
        new EnterpriseRepository(transaction).update(enterpriseId, {
          aiPolicy: { enabledActionKeys: [...new Set(body.enabledActionKeys)], logicalModelTier: 'standard' },
        })
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
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const enterpriseId = parsePostgresId(id, 'enterprise id');
      const enterprise = await withPlatformTransaction((transaction) =>
        new EnterpriseRepository(transaction).findById(enterpriseId)
      );
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
