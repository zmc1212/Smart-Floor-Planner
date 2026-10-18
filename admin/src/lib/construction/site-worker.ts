import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, safeText } from '@/lib/assistant/contracts';
import type { ModelMessage, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { agentConfig } from '@/lib/assistant/agent/config';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { completeRun, failRun, heartbeat, runContext, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { siteDraftPrompt, sitePromptVersion, parseSiteDraft, siteRecordText } from './site-contract';
import { recordVersion } from './site-chat';
import { constructionAccess } from './service';

type Model = (messages: ModelMessage[]) => Promise<ModelTurnOutput>;
function ownerAccess(tx: Parameters<typeof runContext>[0], lease: Lease) {
  if (lease.actor.principal.kind !== 'admin') fail('context_changed');
  return constructionAccess(tx, { enterpriseId: lease.enterpriseId, adminId: lease.actor.principal.adminId,
    miniProgramUserId: lease.actor.entry?.miniProgramUserId as string | undefined,
    miniProgramContextVersion: lease.actor.entry?.miniProgramContextVersion as number | undefined });
}
/** One bounded extraction, no tools or auto-publication. Postgres remains the job and review authority. */
export async function processSiteRecord(lease: Lease, model?: Model) {
  let returned = false;
  const scoped = <T>(work: (tx: Parameters<typeof runContext>[0], record: Row, context: Awaited<ReturnType<typeof runContext>>) => Promise<T>) =>
    withTenantTransaction(lease.enterpriseId, async tx => {
      const context = await runContext(tx, lease);
      if (context.conversation.purpose !== 'project_collaboration' || context.run.purpose !== 'site.record' || lease.actor.principal.kind !== 'admin') fail('context_changed');
      const r = await one(tx, sql`select r.* from app.construction_site_records r join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
        where r.enterprise_id=${lease.enterpriseId} and r.run_id=${lease.runId} and r.status='organizing' and p.status='active' and r.source_message_id is not null for update of r`);
      if (!r) fail('context_changed');
      const member = await one(tx, sql`select role from app.construction_members where enterprise_id=${lease.enterpriseId} and project_id=${String(r.project_id)} and admin_id=${lease.actor.principal.adminId} and active`);
      const owner = await ownerAccess(tx, lease);
      if (!owner && (!member || member.role === 'observer' || (member.role !== 'manager' && String(r.author_id) !== lease.actor.principal.adminId))) fail('context_changed');
      return work(tx, r, context);
    });
  try {
    const initial = await scoped(async (tx, r, context) => {
      const source = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${lease.enterpriseId} and conversation_id=${String(r.conversation_id)} and id=${String(r.source_message_id)} and author_kind='admin'`);
      if (!source) fail('context_changed');
      const rooms = await rows(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${lease.enterpriseId} and project_id=${String(r.project_id)} order by id`);
      const media = await rows(tx, sql`select m.id::text,m.source_hash,m.mime_type,m.data from app.construction_site_attachments x join app.construction_site_media m on m.enterprise_id=x.enterprise_id and m.project_id=x.project_id and m.id=x.media_id
        where x.enterprise_id=${lease.enterpriseId} and x.project_id=${String(r.project_id)} and x.record_id=${String(r.id)} and m.deleted_at is null order by x.position`);
      const config = agentConfig((context.run.policy_snapshot as Row).agent);
      const images = config?.imageInput ? media.map(m => ({ type: 'image' as const, mediaId: String(m.id), hash: String(m.source_hash), mimeType: 'image/jpeg' as const, data: (m.data as Buffer).toString('base64') })) : [];
      const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: siteDraftPrompt }] }, { role: 'user', content: [
        { type: 'text', text: JSON.stringify({ rooms, originalText: safeText(source.content as Parameters<typeof safeText>[0]), photoCount: media.length,
          imageInput: !!images.length, instruction: images.length ? '照片仅辅助辨认部位；事实以原话为准。' : '没有提供图片像素，不可描述照片内容。' }) }, ...images] }];
      const cached = await one(tx, sql`select status,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1100`);
      if (cached && ((cached.input_summary as Row)?.promptVersion !== sitePromptVersion || cached.status !== 'succeeded')) fail('provider_outcome_unknown');
      return { r, rooms, config, messages, cached: cached?.private_checkpoint as ModelTurnOutput | undefined };
    });
    await heartbeat(lease);
    const before = () => scoped(async tx => {
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
        values(${lease.enterpriseId},${lease.runId},1100,'agent_model','running',${JSON.stringify({ promptVersion: sitePromptVersion })}::jsonb)`);
      await tx.execute(sql`update app.assistant_jobs set provider_started_at=now(),updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${lease.jobId}`);
    });
    let attemptId: string | null = null, output = initial.cached;
    if (!output) {
      if (model) { await before(); output = await model(initial.messages); }
      else {
        const result = await executePostgresText({ enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
          logicalModelKey: 'chat.general', maxTokens: 2048, temperature: 0,
          messages: initial.messages.map(m => ({ role: m.role as 'system' | 'user', content: Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : m.content })),
          ...(initial.config ? { agent: { config: initial.config, input: { messages: initial.messages, tools: [], maxTokens: 2048, jsonOutput: true } } } : {}),
          metadata: { promptVersion: sitePromptVersion, projectId: String(initial.r.project_id) }, beforeProviderCall: before });
        attemptId = String(result.attemptId);
        output = result.agentOutput || { text: result.content, toolCalls: [], finishReason: null, providerRequestId: null, usage: null };
      }
      returned = true;
      // Billing survives permission revocation while the provider is in flight.
      await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${attemptId},${'run:' + lease.runId},'tokens',${output!.usage ? output!.usage.inputTokens + output!.usage.outputTokens : null},
        ${output!.usage ? 'observed' : 'unavailable'},${output!.usage?.inputTokens ?? null},${output!.usage?.outputTokens ?? null}) on conflict do nothing`));
      await scoped(async tx => { await tx.execute(sql`update app.assistant_run_steps set status='succeeded',provider_attempt_id=${attemptId},private_checkpoint=${JSON.stringify(output)}::jsonb
        where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1100`); });
    } else returned = true;
    if (output.toolCalls.length || output.finishReason === 'length') fail('invalid_model_answer', 502);
    const draft = parseSiteDraft(output.text, initial.rooms.map(r => String(r.id)));
    await scoped(async tx => {
      if (draft.roomId && !await one(tx, sql`select id from app.construction_rooms where enterprise_id=${lease.enterpriseId} and project_id=${String(initial.r.project_id)} and id=${draft.roomId} and name=${String(initial.rooms.find(r => r.id === draft.roomId)?.name)}`)) fail('context_changed');
    });
    await completeRun(lease, { content: { version: 1, blocks: [{ type: 'text', text: siteRecordText(draft) || '现场资料待核对。' }] }, usage: output.usage, attemptId: attemptId || undefined }, async (tx) => {
      const r = await one(tx, sql`select * from app.construction_site_records where enterprise_id=${lease.enterpriseId} and id=${String(initial.r.id)} and run_id=${lease.runId} and status='organizing' for update`);
      if (!r || Number(r.version) !== Number(initial.r.version)) fail('context_changed');
      const aid = lease.actor.principal.kind === 'admin' ? lease.actor.principal.adminId : '';
      if (!await ownerAccess(tx, lease) && !await one(tx, sql`select admin_id from app.construction_members where enterprise_id=${lease.enterpriseId} and project_id=${String(r.project_id)} and admin_id=${aid}
        and active and role<>'observer' and (role='manager' or admin_id=${String(r.author_id)}) for share`)) fail('context_changed');
      if (draft.roomId && !await one(tx, sql`select id from app.construction_rooms where enterprise_id=${lease.enterpriseId} and project_id=${String(r.project_id)} and id=${draft.roomId} and name=${String(initial.rooms.find(r => r.id === draft.roomId)?.name)}`)) fail('context_changed');
      const updated = (await one(tx, sql`update app.construction_site_records set data=${JSON.stringify(draft)}::jsonb,room_id=${draft.roomId},room_name_snapshot=${String(initial.rooms.find(room => room.id === draft.roomId)?.name || '')},status='draft',version=version+1,updated_at=now()
        where enterprise_id=${lease.enterpriseId} and id=${String(r.id)} returning *`))!;
      await recordVersion(tx, lease.enterpriseId, updated, lease.actor.principal.kind === 'admin' ? lease.actor.principal.adminId : '', 'organized');
    });
  } catch (error) {
    try { await failRun(lease, error instanceof AssistantError ? error.code : 'site_organization_failed', returned); }
    catch (e) { if (!(e instanceof AssistantError && e.code === 'context_changed')) throw e; }
  }
}
