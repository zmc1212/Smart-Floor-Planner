import type { PostgresTransaction } from '@/db/transaction';
import type { Row } from '@/db/repositories/assistant-repository';
import { fingerprint, type ActorContext } from '../contracts';
import { ownedFormalPlan } from './formal-source';

export const floorplanContextProtocol = 'floorplan-context-v1';
export type FloorplanSelection = { leadId: string; floorPlanId: string; layoutHash: string };
export function floorplanContext(entry: unknown): { revision: number; selection: FloorplanSelection | null } {
  const raw = (entry as Row | null)?.floorplanContext as Row | undefined;
  const revision = Number(raw?.revision);
  const value = raw?.selection as FloorplanSelection | undefined;
  return {
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    selection: raw?.protocol === floorplanContextProtocol && value
      && /^[1-9]\d{0,18}$/.test(value.leadId) && /^[1-9]\d{0,18}$/.test(value.floorPlanId)
      && /^[a-f0-9]{64}$/.test(value.layoutHash) ? value : null,
  };
}

/** The explicit scope never grants access. Recheck the original live ownership,
 * primary-plan relation and exact v4 hash at every read and checkpoint replay. */
export async function selectedFormalPlan(tx: PostgresTransaction, actor: ActorContext, entry: unknown): Promise<(Row & { selection: FloorplanSelection }) | null> {
  const selection = floorplanContext(entry).selection;
  if (!selection || actor.principal.kind !== 'user') return null;
  const bound = entry as Row;
  if (bound.kind === 'lead' && String(bound.id) !== selection.leadId) return null;
  const plan = await ownedFormalPlan(tx, actor.enterpriseId, actor.principal.userId, selection.leadId);
  return plan && String(plan.id) === selection.floorPlanId && fingerprint(plan.layout_data) === selection.layoutHash
    ? { ...plan, selection } : null;
}
