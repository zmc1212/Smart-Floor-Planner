import mongoose from 'mongoose';

export type PromotionTimelineType =
  | 'note'
  | 'follow_up'
  | 'report_created'
  | 'ownership_assigned'
  | 'pool_released'
  | 'pool_auto_released'
  | 'pool_claimed'
  | 'pool_claim_requested'
  | 'pool_claim_approved'
  | 'pool_claim_rejected'
  | 'pool_assigned';

export interface PromotionTimelineEntryInput {
  content: string;
  type?: PromotionTimelineType;
  operator?: string;
  operatorId?: unknown;
  operatorRole?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export function toOptionalObjectId(value: unknown) {
  if (!value) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    '_id' in value &&
    typeof (value as { _id?: unknown })._id === 'string' &&
    mongoose.Types.ObjectId.isValid((value as { _id: string })._id)
  ) {
    return new mongoose.Types.ObjectId((value as { _id: string })._id);
  }
  return undefined;
}

export function resolveOperatorName(
  actor?: { displayName?: string; username?: string } | string | null,
  fallback = 'System'
) {
  if (!actor) return fallback;
  if (typeof actor === 'string') return actor || fallback;
  return actor.displayName || actor.username || fallback;
}

export function createPromotionTimelineEntry(input: PromotionTimelineEntryInput) {
  const entry: Record<string, unknown> = {
    content: input.content,
    operator: input.operator || 'System',
    createdAt: input.createdAt || new Date(),
  };

  if (input.type) entry.type = input.type;
  if (input.operatorRole) entry.operatorRole = input.operatorRole;

  const operatorId = toOptionalObjectId(input.operatorId);
  if (operatorId) entry.operatorId = operatorId;

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    entry.metadata = input.metadata;
  }

  return entry;
}
