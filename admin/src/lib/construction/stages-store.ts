import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { defaultConstructionStages, type ConstructionStage, type StageContact } from './stages';

export async function readStageSettings(tx: PostgresTransaction, eid: string) {
  const row = await one(tx, sql`select stages,version from app.construction_stage_settings where enterprise_id=${eid}`);
  return { stages: (row?.stages || defaultConstructionStages) as ConstructionStage[], version: Number(row?.version || 1) };
}
export function currentStage(project: Row, stages: ConstructionStage[]) {
  return stages.find(s => s.key === project.current_stage_key) || null;
}
export async function stageContact(tx: PostgresTransaction, eid: string, project: Row, key: string): Promise<StageContact | null> {
  // Legacy stage_contacts is evidence only. Never use its phone as a fallback.
  const row = await one(tx, sql`select a.display_name,a.phone from app.construction_stage_assignments s
    join app.construction_members m on m.enterprise_id=s.enterprise_id and m.project_id=s.project_id and m.admin_id=s.admin_id and m.active
    join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id and a.status='active'
    where s.enterprise_id=${eid} and s.project_id=${String(project.id)} and s.stage_key=${key} and s.is_primary for share of s,m,a`);
  const phone = String(row?.phone || '').replace(/[\s()-]/g, ''), name = String(row?.display_name || '').trim();
  return name && /^\+?\d{5,20}$/.test(phone) ? { name, phone } : null;
}
