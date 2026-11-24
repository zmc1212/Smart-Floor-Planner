import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { one } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { fail } from '@/lib/assistant/contracts';
import type { ModelTool } from '@/lib/assistant/contracts/model';
import type { Lease } from '@/lib/assistant/infrastructure/job-queue';
import { isMainWechat } from '@/lib/assistant/wechat/subject';
import type { ChannelRow } from '@/lib/assistant/wechat/channels';
import { selectReport } from '@/lib/assistant/wechat/reports';
import { mainRelease } from './main-publication';
import { stageDefinition, stageIdSchema } from './stages';
import { readStageAgent } from './stage-workflow-settings';
import { answerStageQuestion } from './stage-answer';
import { stageText } from './stage-experience';
import { invokeBoundStageWorkflow } from './stage-workflow-invocation';

const stageInput = z.strictObject({stage:stageIdSchema});
const reportInput = z.strictObject({period:z.enum(['daily','weekly'])});
export const stageToolName = 'consult_renovation_stage';
export const reportToolName = 'open_my_site_report';

export async function mainDialogueTools(tx: PostgresTransaction, lease: Lease, question: string) {
  const wechat = isMainWechat(lease.actor);
  const release = await mainRelease(tx, lease.enterpriseId);
  if (!release?.enabled) { if (wechat) fail('context_changed'); return null; }
  const channelId = String(lease.actor.entry?.channelId ?? '');
  const user = lease.actor.principal.kind === 'user' ? lease.actor.principal.userId : '';
  const connection = (db: PostgresTransaction) => one<ChannelRow>(db, sql`select * from app.assistant_wechat_channels where
    enterprise_id=${lease.enterpriseId} and id=${channelId} and user_id=${user} and stage_id='main' and status='connected' for share`);
  if (wechat && !await connection(tx)) fail('context_changed');
  const checkpoint = await one<{v:number}>(tx, sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint)
    values(${lease.enterpriseId},${lease.runId},3099,'main_publication','succeeded',jsonb_build_object('v',${release.version}::int))
    on conflict(enterprise_id,run_id,step_seq) do update set kind=excluded.kind returning (private_checkpoint->>'v')::int as v`);
  if (checkpoint?.v !== release.version) fail('context_changed');
  const stages = release.stages.filter(s => s.enabled);
  const definitions: ModelTool[] = [];
  if (stages.length) definitions.push({name:stageToolName,description:'根据当前问题选择装修阶段并读取该阶段已发布的指导。'+
    stages.map(a => a.stageId+'：'+a.name).join('，'),parameters:{type:'object',properties:{stage:{type:'string',enum:stages.map(a=>a.stageId)}},required:['stage'],additionalProperties:false}});
  if (wechat && release.reports) definitions.push({name:reportToolName,description:'查本人已关联的获权日报或周报，周度用 weekly，当天用 daily。结果由微信私下展示。',
    parameters:{type:'object',properties:{period:{type:'string',enum:['daily','weekly']}},required:['period'],additionalProperties:false}});
  const revalidate = async (db:PostgresTransaction) => {
    const current = await mainRelease(db, lease.enterpriseId);
    if (!current?.enabled || current.version !== release.version || wechat && !await connection(db)) fail('context_changed');
    if (await one(db, sql`select 1 from app.assistant_run_steps r join app.assistant_stage_agents a
      on a.enterprise_id=r.enterprise_id and a.stage_id=r.input_summary->>'stage' and not a.enabled
      where r.enterprise_id=${lease.enterpriseId} and r.run_id=${lease.runId} and r.kind='agent_tool' and r.capability_name=${stageToolName}`)) fail('context_changed');
  };
  return { definitions, revalidate, async invoke(db: PostgresTransaction, name: string, args: string, step: number) {
    await revalidate(db);
    let body: unknown;
    try { body = JSON.parse(args); } catch { return fail('invalid_message',422); }
    if (name === reportToolName && wechat && release.reports) {
      const input = reportInput.safeParse(body), channel = await connection(db);
      if (!input.success || !channel) fail('context_changed');
      return selectReport(db, channel, input.data.period, lease.runId);
    }
    const input = stageInput.safeParse(body);
    if (name !== stageToolName || !input.success) fail('invalid_message',422);
    const a = stages.find(s => s.stageId === input.data.stage);
    if (!a || !(await readStageAgent(db, lease.enterpriseId, a.stageId))?.enabled) fail('context_changed');
    const base = answerStageQuestion({constructionStageKey:stageDefinition(a.stageId)!.constructionKeys[0],question,audience:'owner'});
    const result = a.defaultWorkflowId && base.intent === 'stage_knowledge' ?
      await invokeBoundStageWorkflow(a,a.defaultWorkflowId,base,'owner',lease.runId+':'+step) : base;
    await db.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,capability_name,input_summary)
      values(${lease.enterpriseId},${lease.runId},${step},'agent_tool','succeeded',${stageToolName},${JSON.stringify({stage:a.stageId,version:a.version})}::jsonb)
      on conflict (enterprise_id,run_id,step_seq) do nothing`);
    return JSON.stringify({stage:a.name,responsibility:a.description,guidance:result.answer,
      style:a.experience ? stageText(a.experience.prompt,a.name,a.experience.variables) : '',source:'通用阶段指导'});
  }};
}
