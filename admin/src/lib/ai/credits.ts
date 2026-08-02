import mongoose from 'mongoose';
import { AiCreditPriceRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { AiCreditAccount } from '@/models/AiCreditAccount';
import { AiCreditLedger, type AiCreditLedgerType } from '@/models/AiCreditLedger';
import type { MiniAiTaskType } from '@/models/AiCreditPrice';
import type { AiActionKey } from '@/lib/ai/provider-types';

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

function asTenantId(value: string | mongoose.Types.ObjectId) {
  return value;
}

function asGenerationId(value: string | mongoose.Types.ObjectId) {
  return typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value;
}

function normalizeCredits(value: number) {
  const amount = Math.trunc(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('AI 点数数量必须是正整数');
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
  if (!price) {
    throw new Error('当前 AI 功能未开放');
  }
  return normalizeAiCreditPrice(price);
}

export async function ensureAiCreditAccount(enterpriseId: string | mongoose.Types.ObjectId) {
  return AiCreditAccount.findOneAndUpdate(
    { enterpriseId: asTenantId(enterpriseId) },
    { $setOnInsert: { balance: 0, frozenBalance: 0, version: 0, appliedOperationIds: [] } },
    { upsert: true, returnDocument: 'after' }
  );
}

export function serializeAiCreditAccount(account: {
  balance?: number;
  frozenBalance?: number;
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

async function claimOperation(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  generationId?: string | mongoose.Types.ObjectId;
  operatorId?: string | mongoose.Types.ObjectId;
  operationId: string;
  type: AiCreditLedgerType;
  amount: number;
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    return await AiCreditLedger.create({
      enterpriseId: asTenantId(input.enterpriseId),
      generationId: input.generationId ? asGenerationId(input.generationId) : undefined,
      operatorId: input.operatorId ? asTenantId(input.operatorId) : undefined,
      operationId: input.operationId,
      type: input.type,
      amount: input.amount,
      status: 'pending',
      note: input.note,
      metadata: input.metadata,
    });
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
    const existing = await AiCreditLedger.findOne({ operationId: input.operationId });
    if (!existing) throw error;
    return existing;
  }
}

async function completeOperation(
  ledger: Awaited<ReturnType<typeof claimOperation>>,
  account: { balance: number; frozenBalance: number }
) {
  ledger.status = 'completed';
  ledger.balanceAfter = Number(account.balance || 0);
  ledger.frozenAfter = Number(account.frozenBalance || 0);
  await ledger.save();
  return { ledger, account };
}

async function failOperation(ledger: Awaited<ReturnType<typeof claimOperation>>) {
  if (ledger.status === 'pending') {
    ledger.status = 'failed';
    await ledger.save();
  }
}

function operationUpdate(operationId: string, increments: Record<string, number>) {
  return {
    $inc: { ...increments, version: 1 },
    $push: { appliedOperationIds: { $each: [operationId], $slice: -5000 } },
  };
}

async function recoverAppliedOperation(
  ledger: Awaited<ReturnType<typeof claimOperation>>,
  enterpriseId: string | mongoose.Types.ObjectId,
  operationId: string
) {
  const account = await AiCreditAccount.findOne({
    enterpriseId: asTenantId(enterpriseId),
    appliedOperationIds: operationId,
  }).select('+appliedOperationIds');
  return account ? completeOperation(ledger, account) : null;
}

export async function grantAiCredits(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  operatorId: string | mongoose.Types.ObjectId;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = normalizeCredits(input.amount);
  await ensureAiCreditAccount(input.enterpriseId);
  const ledger = await claimOperation({ ...input, amount, type: 'grant' });
  if (ledger.status === 'completed') {
    return { ledger, account: await ensureAiCreditAccount(input.enterpriseId) };
  }
  if (ledger.status !== 'pending') throw new Error('该充值操作已失败，请使用新的操作编号');

  const account = await AiCreditAccount.findOneAndUpdate(
    { enterpriseId: asTenantId(input.enterpriseId), appliedOperationIds: { $ne: input.operationId } },
    operationUpdate(input.operationId, { balance: amount }),
    { returnDocument: 'after' }
  );
  if (!account) {
    const recovered = await recoverAppliedOperation(ledger, input.enterpriseId, input.operationId);
    if (recovered) return recovered;
    await failOperation(ledger);
    throw new Error('AI 点数账户不存在');
  }
  return completeOperation(ledger, account);
}

export async function adjustAiCredits(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  operatorId: string | mongoose.Types.ObjectId;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = Math.trunc(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) throw new Error('调整数量不能为 0');
  await ensureAiCreditAccount(input.enterpriseId);
  const ledger = await claimOperation({ ...input, amount, type: 'adjust' });
  if (ledger.status === 'completed') {
    return { ledger, account: await ensureAiCreditAccount(input.enterpriseId) };
  }

  const filter: Record<string, unknown> = {
    enterpriseId: asTenantId(input.enterpriseId),
    appliedOperationIds: { $ne: input.operationId },
  };
  if (amount < 0) {
    filter.$expr = { $gte: [{ $subtract: ['$balance', '$frozenBalance'] }, Math.abs(amount)] };
  }
  const account = await AiCreditAccount.findOneAndUpdate(
    filter,
    operationUpdate(input.operationId, { balance: amount }),
    { returnDocument: 'after' }
  );
  if (!account) {
    const recovered = await recoverAppliedOperation(ledger, input.enterpriseId, input.operationId);
    if (recovered) return recovered;
    await failOperation(ledger);
    throw new InsufficientAiCreditsError();
  }
  return completeOperation(ledger, account);
}

export async function holdAiCredits(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  generationId: string | mongoose.Types.ObjectId;
  operatorId: string | mongoose.Types.ObjectId;
  amount: number;
  operationId: string;
}) {
  const amount = normalizeCredits(input.amount);
  await ensureAiCreditAccount(input.enterpriseId);
  const ledger = await claimOperation({ ...input, amount, type: 'hold' });
  if (ledger.status === 'completed') {
    return { ledger, account: await ensureAiCreditAccount(input.enterpriseId) };
  }

  const account = await AiCreditAccount.findOneAndUpdate(
    {
      enterpriseId: asTenantId(input.enterpriseId),
      appliedOperationIds: { $ne: input.operationId },
      $expr: { $gte: [{ $subtract: ['$balance', '$frozenBalance'] }, amount] },
    },
    operationUpdate(input.operationId, { frozenBalance: amount }),
    { returnDocument: 'after' }
  );
  if (!account) {
    const recovered = await recoverAppliedOperation(ledger, input.enterpriseId, input.operationId);
    if (recovered) return recovered;
    await failOperation(ledger);
    throw new InsufficientAiCreditsError();
  }
  return completeOperation(ledger, account);
}

export async function consumeHeldAiCredits(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  generationId: string | mongoose.Types.ObjectId;
  operatorId: string | mongoose.Types.ObjectId;
  amount: number;
  operationId: string;
}) {
  const amount = normalizeCredits(input.amount);
  const ledger = await claimOperation({ ...input, amount: -amount, type: 'consume' });
  if (ledger.status === 'completed') {
    return { ledger, account: await ensureAiCreditAccount(input.enterpriseId) };
  }
  const account = await AiCreditAccount.findOneAndUpdate(
    {
      enterpriseId: asTenantId(input.enterpriseId),
      appliedOperationIds: { $ne: input.operationId },
      balance: { $gte: amount },
      frozenBalance: { $gte: amount },
    },
    operationUpdate(input.operationId, { balance: -amount, frozenBalance: -amount }),
    { returnDocument: 'after' }
  );
  if (!account) {
    const recovered = await recoverAppliedOperation(ledger, input.enterpriseId, input.operationId);
    if (recovered) return recovered;
    await failOperation(ledger);
    throw new Error('AI 点数冻结记录不一致，无法完成扣费');
  }
  return completeOperation(ledger, account);
}

export async function releaseHeldAiCredits(input: {
  enterpriseId: string | mongoose.Types.ObjectId;
  generationId: string | mongoose.Types.ObjectId;
  operatorId: string | mongoose.Types.ObjectId;
  amount: number;
  operationId: string;
  note?: string;
}) {
  const amount = normalizeCredits(input.amount);
  const ledger = await claimOperation({ ...input, amount, type: 'release' });
  if (ledger.status === 'completed') {
    return { ledger, account: await ensureAiCreditAccount(input.enterpriseId) };
  }
  const account = await AiCreditAccount.findOneAndUpdate(
    {
      enterpriseId: asTenantId(input.enterpriseId),
      appliedOperationIds: { $ne: input.operationId },
      frozenBalance: { $gte: amount },
    },
    operationUpdate(input.operationId, { frozenBalance: -amount }),
    { returnDocument: 'after' }
  );
  if (!account) {
    const recovered = await recoverAppliedOperation(ledger, input.enterpriseId, input.operationId);
    if (recovered) return recovered;
    await failOperation(ledger);
    throw new Error('AI 点数冻结记录不存在或已释放');
  }
  return completeOperation(ledger, account);
}
