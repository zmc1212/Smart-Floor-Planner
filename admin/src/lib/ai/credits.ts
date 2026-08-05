import {
  AiCreditPriceRepository,
  AiCreditRepository,
  type AiCreditLedgerType,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import type { AiActionKey } from '@/lib/ai/provider-types';

type MiniAiTaskType =
  | 'reference_recreate'
  | 'style_transform'
  | 'floor_plan_render'
  | 'soft_furnishing';

const DEFAULT_PRICES: Array<{ actionKey: AiActionKey; mode?: MiniAiTaskType; label: string; credits: number }> = [
  { actionKey: 'image.free_create', label: 'AI 自由创作', credits: 10 },
  { actionKey: 'image.reference_recreate', mode: 'reference_recreate', label: '复刻心动网图', credits: 10 },
  { actionKey: 'image.style_transform', mode: 'style_transform', label: '空间换风格', credits: 10 },
  { actionKey: 'image.floor_plan_style', mode: 'floor_plan_render', label: '户型概念效果图', credits: 10 },
  { actionKey: 'image.furnishing_render', label: '空间效果图生成', credits: 10 },
  { actionKey: 'image.soft_furnishing_render', mode: 'soft_furnishing', label: '软装效果图生成', credits: 10 },
  { actionKey: 'image.scenario', label: '场景方案生成', credits: 10 },
  { actionKey: 'text.design_advice', label: 'AI 设计建议', credits: 1 },
];

const LEGACY_MODE_TO_ACTION: Record<MiniAiTaskType, AiActionKey> = {
  reference_recreate: 'image.reference_recreate',
  style_transform: 'image.style_transform',
  floor_plan_render: 'image.floor_plan_style',
  soft_furnishing: 'image.soft_furnishing_render',
};

export class InsufficientAiCreditsError extends Error {
  status = 402;

  constructor() {
    super('当前企业 AI 点数不足，请联系平台管理员调整。');
  }
}

function normalizeCredits(value: number) {
  const amount = Math.trunc(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('AI 点数数量必须是正整数');
  }
  return amount;
}

export function toSafeCreditAmount(value: bigint | number) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('AI 点数价格超出当前创作任务的安全范围');
  }
  return amount;
}

export async function ensureDefaultAiCreditPrices() {
  await withPlatformTransaction(async (transaction) => {
    await new AiCreditPriceRepository(transaction).ensureDefaults(
      DEFAULT_PRICES.map((item) => ({
        actionKey: item.actionKey,
        mode: item.mode,
        label: item.label,
        credits: BigInt(item.credits),
        enabled: true,
      }))
    );
  });
}

function normalizeAiCreditPrice(price: {
  id: bigint;
  actionKey: string;
  mode: string | null;
  label: string;
  credits: bigint;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { id, ...rest } = price;
  return { ...rest, _id: id.toString(), credits: Number(price.credits) };
}

export async function listAiCreditPrices() {
  await ensureDefaultAiCreditPrices();
  return withPlatformTransaction(async (transaction) =>
    (await new AiCreditPriceRepository(transaction).list()).map(normalizeAiCreditPrice)
  );
}

export async function getAiCreditPrice(actionKeyOrMode: AiActionKey | MiniAiTaskType) {
  await ensureDefaultAiCreditPrices();
  const actionKey = actionKeyOrMode in LEGACY_MODE_TO_ACTION
    ? LEGACY_MODE_TO_ACTION[actionKeyOrMode as MiniAiTaskType]
    : actionKeyOrMode;
  const price = await withPlatformTransaction((transaction) =>
    new AiCreditPriceRepository(transaction).findEnabledByActionKey(actionKey)
  );
  if (!price) throw new Error('当前 AI 功能未开放');
  return normalizeAiCreditPrice(price);
}

export async function ensureAiCreditAccount(enterpriseId: string | bigint) {
  const parsedEnterpriseId = parsePostgresId(enterpriseId, 'enterpriseId');
  return withTenantTransaction(parsedEnterpriseId, (transaction) =>
    new AiCreditRepository(transaction).ensureAccount(parsedEnterpriseId)
  );
}

export function serializeAiCreditAccount(account: {
  balance?: number | bigint;
  frozenBalance?: number | bigint;
  version?: number;
}) {
  const balance = Number(account.balance || 0);
  const frozenBalance = Number(account.frozenBalance || 0);
  return {
    balance,
    frozenBalance,
    availableBalance: Math.max(0, balance - frozenBalance),
    version: Number(account.version || 0),
  };
}

function optionalPostgresId(value: string | bigint | undefined) {
  const normalized = value === undefined ? '' : String(value);
  return /^[1-9]\d*$/.test(normalized) ? BigInt(normalized) : null;
}

type AiCreditOperationInput = {
  enterpriseId: string | bigint;
  generationId?: string | bigint;
  operatorId?: string | bigint;
  operationId: string;
  type: AiCreditLedgerType;
  amount: number;
  note?: string;
  metadata?: Record<string, unknown>;
};

type AiCreditBalanceChange = {
  balanceDelta: bigint;
  frozenDelta: bigint;
  requireAvailableAtLeast?: bigint;
  requireBalanceAtLeast?: bigint;
  requireFrozenAtLeast?: bigint;
  failureMessage: string;
  insufficient?: boolean;
};

async function applyAiCreditOperation(input: AiCreditOperationInput, change: AiCreditBalanceChange) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const result = await withTenantTransaction(enterpriseId, async (transaction) => {
    const credits = new AiCreditRepository(transaction);
    await credits.ensureAccount(enterpriseId);
    const claim = await credits.claimLedger({
      enterpriseId,
      generationId: optionalPostgresId(input.generationId),
      operatorId: optionalPostgresId(input.operatorId),
      operationId: input.operationId,
      type: input.type,
      amount: BigInt(input.amount),
      note: input.note,
      metadata: input.metadata,
    });
    if (!claim.claimed) {
      if (claim.ledger.enterpriseId !== enterpriseId) {
        throw new Error('AI credit operation belongs to another enterprise');
      }
      const account = await credits.findAccount(enterpriseId);
      if (!account) throw new Error('AI credit account is missing');
      if (claim.ledger.status === 'completed') return { ledger: claim.ledger, account };
      return { failure: '该点数操作已失败，请使用新的操作编号', insufficient: false };
    }

    const account = await credits.applyBalance({ enterpriseId, ...change });
    if (!account) {
      await credits.failLedger(claim.ledger.id);
      return { failure: change.failureMessage, insufficient: Boolean(change.insufficient) };
    }
    const ledger = await credits.completeLedger(claim.ledger.id, account);
    if (!ledger) throw new Error('AI credit ledger could not be completed');
    return { ledger, account };
  });
  if ('failure' in result) {
    if (result.insufficient) throw new InsufficientAiCreditsError();
    throw new Error(result.failure);
  }
  return result;
}

export async function grantAiCredits(input: {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = normalizeCredits(input.amount);
  return applyAiCreditOperation(
    { ...input, amount, type: 'grant' },
    { balanceDelta: BigInt(amount), frozenDelta: BigInt(0), failureMessage: 'AI 点数账户不存在' }
  );
}

export async function adjustAiCredits(input: {
  enterpriseId: string | bigint;
  operatorId: string | bigint;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = Math.trunc(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) throw new Error('调整数量不能为 0');
  return applyAiCreditOperation(
    { ...input, amount, type: 'adjust' },
    {
      balanceDelta: BigInt(amount),
      frozenDelta: BigInt(0),
      ...(amount < 0 ? { requireAvailableAtLeast: BigInt(Math.abs(amount)) } : {}),
      failureMessage: '当前企业 AI 点数不足，请联系平台管理员调整。',
      insufficient: amount < 0,
    }
  );
}

export async function holdAiCredits(input: {
  enterpriseId: string | bigint;
  generationId: string | bigint;
  operatorId: string | bigint;
  amount: number;
  operationId: string;
}) {
  const amount = normalizeCredits(input.amount);
  return applyAiCreditOperation(
    { ...input, amount, type: 'hold' },
    {
      balanceDelta: BigInt(0),
      frozenDelta: BigInt(amount),
      requireAvailableAtLeast: BigInt(amount),
      failureMessage: '当前企业 AI 点数不足，请联系平台管理员调整。',
      insufficient: true,
    }
  );
}

export async function consumeHeldAiCredits(input: {
  enterpriseId: string | bigint;
  generationId: string | bigint;
  operatorId: string | bigint;
  amount: number;
  operationId: string;
}) {
  const amount = normalizeCredits(input.amount);
  return applyAiCreditOperation(
    { ...input, amount: -amount, type: 'consume' },
    {
      balanceDelta: BigInt(-amount),
      frozenDelta: BigInt(-amount),
      requireBalanceAtLeast: BigInt(amount),
      requireFrozenAtLeast: BigInt(amount),
      failureMessage: 'AI 点数冻结记录不一致，无法完成扣费',
    }
  );
}

export async function releaseHeldAiCredits(input: {
  enterpriseId: string | bigint;
  generationId: string | bigint;
  operatorId: string | bigint;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = normalizeCredits(input.amount);
  return applyAiCreditOperation(
    { ...input, amount, type: 'release' },
    {
      balanceDelta: BigInt(0),
      frozenDelta: BigInt(-amount),
      requireFrozenAtLeast: BigInt(amount),
      failureMessage: 'AI 点数冻结记录不存在或已释放',
    }
  );
}
