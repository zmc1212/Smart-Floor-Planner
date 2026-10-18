import { AssistantError } from '../contracts';

export const RETENTION_VERSION = 1 as const;
export const RETENTION_MARKER = 'assistant_retention_redacted_v1' as const;
export const RETENTION_CITATION_MARKER = 'assistant_retention_citation_redacted_v1' as const;
export const RETENTION_BATCH_SIZE = 100 as const;

export type RetentionMode = 'dry-run' | 'apply';

export type RetentionBlockReason =
  | 'active_run'
  | 'active_job'
  | 'active_provider_attempt'
  | 'unknown_cost'
  | 'already_redacted';

export type RetentionCandidate = {
  conversationId: string;
  status: string;
  updatedAt: Date | string;
  eligible: boolean;
  reasons: RetentionBlockReason[];
};

export type RetentionPlan = {
  enterpriseId: string;
  retentionDays: number;
  cutoff: Date;
  candidates: RetentionCandidate[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type RetentionRedactionCounts = {
  conversations: number;
  messages: number;
  citations: number;
  runSteps: number;
  runs: number;
  outboxPayloads: number;
  auditEvents: number;
  idempotencyResults: number;
  requirementSummaries: number;
};

export const PRESERVED_RETENTION_DATA = [
  'assistant_idempotency_records',
  'assistant_quota_reservations',
  'assistant_cost_reviews',
  'assistant_usage_records',
  'ai_provider_attempts',
  'assistant_jobs',
  'assistant_runs',
  'assistant_message_citations',
  'assistant_knowledge_index_profiles',
  'assistant_knowledge_documents',
  'assistant_knowledge_versions',
  'assistant_knowledge_chunks',
  'assistant_knowledge_attempts',
] as const;

export function retentionCutoff(now: Date, retentionDays: number): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AssistantError('invalid_message', 422);
  }
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new AssistantError('assistant_disabled', 403);
  }
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff;
}

export function retentionMarkerPayload() {
  return {
    retentionRedacted: true,
    retentionVersion: RETENTION_VERSION,
    marker: RETENTION_MARKER,
  } as const;
}

export function redactedMessageContent() {
  return {
    version: 1,
    blocks: [
      {
        type: 'notice' as const,
        code: 'retention_redacted',
        fallbackText: '内容已按保留策略清理',
      },
    ],
    ...retentionMarkerPayload(),
  } as const;
}

export function redactedCitationLocator() {
  return {
    retentionRedacted: true,
    retentionVersion: RETENTION_VERSION,
    marker: RETENTION_CITATION_MARKER,
  } as const;
}

export function isRetentionRedacted(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).retentionRedacted === true
  );
}

export function candidateReasons(input: {
  activeRun?: boolean;
  activeJob?: boolean;
  activeProviderAttempt?: boolean;
  unknownCost?: boolean;
  alreadyRedacted?: boolean;
}): RetentionBlockReason[] {
  const reasons: RetentionBlockReason[] = [];
  if (input.activeRun) reasons.push('active_run');
  if (input.activeJob) reasons.push('active_job');
  if (input.activeProviderAttempt) reasons.push('active_provider_attempt');
  if (input.unknownCost) reasons.push('unknown_cost');
  if (input.alreadyRedacted) reasons.push('already_redacted');
  return reasons;
}

export function isRetentionEligible(reasons: RetentionBlockReason[]): boolean {
  return reasons.length === 0;
}

export type RetentionCliArgs = {
  enterpriseId: string;
  adminId: string;
  mode: RetentionMode;
  now?: Date;
  afterConversationId?: string;
};

function positiveId(value: unknown, flag: string): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > BigInt('9223372036854775807')
  ) {
    throw new Error(`${flag} requires a positive PostgreSQL bigint`);
  }
  return value;
}

export function parseRetentionCliArgs(argv: string[]): RetentionCliArgs {
  let enterpriseId: string | undefined;
  let adminId: string | undefined;
  let mode: RetentionMode = 'dry-run';
  let now: Date | undefined;
  let afterConversationId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      mode = 'apply';
      continue;
    }
    if (argument === '--enterprise-id' || argument === '--admin-id' || argument === '--now' || argument === '--after-conversation-id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--enterprise-id') enterpriseId = positiveId(value, argument);
      else if (argument === '--admin-id') adminId = positiveId(value, argument);
      else if (argument === '--after-conversation-id') afterConversationId = positiveId(value, argument);
      else {
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) throw new Error('--now requires an ISO date');
        now = parsed;
      }
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      throw new Error('usage: assistant-retention --enterprise-id <id> --admin-id <id> [--apply] [--now <ISO>] [--after-conversation-id <id>]');
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (!enterpriseId) throw new Error('--enterprise-id is required');
  if (!adminId) throw new Error('--admin-id is required');
  if (mode === 'apply' && now) {
    throw new Error('--now is only supported for dry-run; apply always uses database server time');
  }
  return { enterpriseId, adminId, mode, now, afterConversationId };
}
