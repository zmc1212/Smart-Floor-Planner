import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { authorizeKnowledgeManager } from '@/lib/assistant/knowledge/manager';
import { readStageAgent, type EnterpriseStageAgent } from './stage-workflow-settings';
import { stageIdSchema, stageIds } from './stages';

export type MainRelease = { version: number; enabled: boolean; reports: boolean; stages: EnterpriseStageAgent[] };
export const publicationInput = z.strictObject({ expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(),
  stages: z.array(stageIdSchema).max(stageIds.length), reports: z.boolean() }).refine(p =>
  new Set(p.stages).size === p.stages.length && (!p.enabled || p.reports || p.stages.length > 0));

export function mainRelease(tx: PostgresTransaction, enterprise: string) {
  return one<MainRelease>(tx, sql`select version,enabled,reports,stages from app.assistant_main_publications
    where enterprise_id=${enterprise} for share`);
}
function view(p?: MainRelease) {
  return { version: p?.version ?? 0, enabled: p?.enabled ?? false, reports: p?.reports ?? true,
    stages: p?.stages.map(a => a.stageId) ?? [...stageIds] };
}
export function manageMainPublication(enterprise: string, admin: string, input?: z.infer<typeof publicationInput>) {
  return withTenantTransaction(enterprise, async tx => {
    await authorizeKnowledgeManager(tx, enterprise, admin);
    if (!input) return view(await mainRelease(tx, enterprise));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'main-publication:' + enterprise},0))`);
    const existing = await mainRelease(tx, enterprise);
    if ((existing?.version ?? 0) !== input.expectedVersion) fail('version_conflict');
    const stages: EnterpriseStageAgent[] = [];
    for (const stage of input.stages) {
      const agent = await readStageAgent(tx, enterprise, stage);
      if (!agent?.enabled && input.enabled) fail('wechat_stage_disabled');
      if (agent) stages.push({ ...agent, history: undefined });
    }
    const release = { version: input.expectedVersion + 1, enabled: input.enabled, stages, reports: input.reports };
    await tx.execute(sql`insert into app.assistant_main_publications(enterprise_id,version,enabled,stages,reports)
      values(${enterprise},${release.version},${release.enabled},${JSON.stringify(stages)}::jsonb,${release.reports})
      on conflict (enterprise_id) do update set version=excluded.version,enabled=excluded.enabled,stages=excluded.stages,reports=excluded.reports`);
    if (!release.enabled) {
      const { closeChannel } = await import('@/lib/assistant/wechat/channels');
      const channels = await rows<import('@/lib/assistant/wechat/channels').ChannelRow>(tx, sql`select * from app.assistant_wechat_channels
        where enterprise_id=${enterprise} and stage_id='main' and status<>'closed' order by id for update`);
      for (const channel of channels) await closeChannel(tx, channel, 'disabled');
    } else if (!release.reports) {
      await tx.execute(sql`update app.assistant_wechat_channels set daily_since=null,weekly_since=null,recipient_version=recipient_version+1
        where enterprise_id=${enterprise} and stage_id='main' and status<>'closed' and recipient_key is not null`);
    }
    return view(release);
  });
}
