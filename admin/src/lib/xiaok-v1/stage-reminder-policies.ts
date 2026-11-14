import { stageDefinitions, type StageId } from './stages';
import type { StageReminderPolicy } from './reminder-engine';

const quietHours = { start: 21, end: 8 } as const;
const roles = ['owner', 'designer', 'worker', 'manager'] as const;

/** One policy per stage. Frequencies are configuration, not code branches.
 * A missing plan or record still suppresses the corresponding reminder. */
export const stageReminderPolicies: readonly StageReminderPolicy[] = stageDefinitions.map(stage => ({
  policyId: `stage-reminder-${stage.stageId}-v1`,
  stageId: stage.stageId,
  version: 1,
  status: 'active',
  enterStage: true,
  midStageAfterDays: 5,
  endPreparationDays: 3,
  dueSoonDays: 3,
  staleRecordDays: 7,
  issueOverdueGraceDays: 1,
  bossEscalationDays: 3,
  cooldownHours: 24,
  quietHours,
  roles: [...roles],
}));

const byStage = new Map<StageId, StageReminderPolicy>(stageReminderPolicies.map(policy => [policy.stageId, policy]));

export function reminderPolicyForStage(stageId: StageId): StageReminderPolicy | null {
  return byStage.get(stageId) ?? null;
}

export function reminderPolicyById(policyId: string): StageReminderPolicy | null {
  return stageReminderPolicies.find(policy => policy.policyId === policyId) ?? null;
}
