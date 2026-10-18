import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AiProviderError } from '@/lib/ai/provider-types';
import { AssistantError, fail, safeText, type Evidence, type KnowledgeRetriever, type TextModelGateway } from '../contracts';
import { retrieveKnowledge } from '../knowledge/retrieval';
import { answerMessages, insufficientAnswer, parseSelection } from '../knowledge/answer';
import { completeAnswer, completeGuidance, failRun, heartbeat, markProviderStarted, runContext, type Lease } from './job-queue';
import { configuredGuidance, conversationGuidance, guidanceProgress } from '../requirements/guidance';
import { requirementCheckpoint } from '../requirements/checkpoint';
import { textGateway } from './model-gateway';
import { embeddingGateway } from './embedding-gateway';
import { chatFirstProgress, defaultGuidance } from '../requirements/guidance';
import { needsDesignerSuggestion, designerSuggestion } from '../handoff/intent';
import { agentConfig } from '../agent/config';
import { processAgentAnswer } from '../agent/worker';

type Dependencies={retriever?:KnowledgeRetriever;model?:TextModelGateway};
export async function processAnswer(lease:Lease,deps:Dependencies={}) {
  let returned=false;
  let stage:'retrieval'|'model'='retrieval';
  try {
    const context=await withTenantTransaction(lease.enterpriseId,tx=>runContext(tx,lease));
    if (lease.actor.principal.kind === 'user' && agentConfig((context.run.policy_snapshot as Row).agent)) {
      await processAgentAnswer(lease); return;
    }
    if(context.run.trigger_kind!=='user_message')fail('assistant_capability_forbidden',403);
    const messages=await withTenantTransaction(lease.enterpriseId,async tx=>{
      await runContext(tx,lease);
      return rows(tx,sql`select m.* from app.assistant_messages m join app.assistant_messages trigger on trigger.enterprise_id=m.enterprise_id
        and trigger.conversation_id=m.conversation_id where m.enterprise_id=${lease.enterpriseId} and trigger.id=${String(context.run.trigger_message_id)}
        and m.conversation_id=${String(context.run.conversation_id)} and m.seq<=trigger.seq and m.author_kind in ('user','admin') order by m.seq desc limit 3`);
    });
    if(!messages.length || String(messages[0].id)!==String(context.run.trigger_message_id))fail('context_changed');
    const read=(m:Row)=>safeText(m.content as Parameters<typeof safeText>[0]);
    const query=read(messages[0]);
    if (needsDesignerSuggestion(query)) { await completeGuidance(lease, designerSuggestion); return; }
    if (/回顾|总结.*(?:需求|想法)|(?:需求|想法).*总结|整理一下|记了哪些想法|记住了什么/.test(query)) {
      const turns = await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        return rows(tx, sql`select id,content from app.assistant_messages where enterprise_id=${lease.enterpriseId}
          and conversation_id=${String(context.run.conversation_id)} and author_kind='user' order by seq desc limit 200`);
      });
      const fields = chatFirstProgress(defaultGuidance, turns.reverse().map(m => ({ id: String(m.id), text: read(m) }))).fields;
      const labels = { housing: '房屋', household: '居住', style: '风格', budget: '预算', timeline: '时间', room: '房间想法' };
      const lines = Object.entries(labels).filter(([k]) => fields[k as keyof typeof fields]?.text)
        .map(([k, label]) => label + '：' + fields[k as keyof typeof fields].text);
      await completeGuidance(lease, lines.length ? '目前记下的想法：\n' + lines.join('\n') + '\n想改哪里，直接告诉我就好。' : '还没有足够的信息可以回顾，你可以先说说想法。');
      return;
    }
    const followup: string | undefined = undefined;
    const guidance = conversationGuidance(context.conversation.entry_snapshot);
    if (guidance && lease.actor.principal.kind === 'user') {
      const inputs = await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        const settings = await one(tx, sql`select guidance_config from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId}`);
        if (!configuredGuidance(settings?.guidance_config).enabled) return null;
        return rows(tx, sql`select id,content from app.assistant_messages where enterprise_id=${lease.enterpriseId}
          and conversation_id=${String(context.run.conversation_id)} and author_kind='user' and seq<=${String(messages[0].seq)} order by seq limit 201`);
      });
      if (inputs && inputs.length <= 200) {
        const turns = inputs.map(m => ({ id: String(m.id), text: read(m) }));
        const checkpoint = await withTenantTransaction(lease.enterpriseId, async tx => {
          await runContext(tx, lease);
          return requirementCheckpoint(tx, lease.enterpriseId, String(context.run.conversation_id));
        });
        const before = guidanceProgress(guidance, turns.slice(0, -1), checkpoint), progress = guidanceProgress(guidance, turns, checkpoint);
        const corrected = !!guidance.schemaVersion && !progress.interrupt
          && JSON.stringify(before.fields) !== JSON.stringify(progress.fields);
        if (corrected && progress.paused) {
          const changed = Object.entries(progress.fields).filter(([k, v]) => v.text && v.text !== before.fields[k as keyof typeof before.fields]?.text).map(([, v]) => v.text);
          await completeGuidance(lease, '记下了：' + changed.join('；') + '。你可以继续说想法，也可以换个话题。'); return;
        }
        if (progress.lastControl || (before.next && !before.paused) || corrected) {
          if (!progress.interrupt && !progress.paused) { await completeGuidance(lease, progress.reply); return; }
        }
      }
    }
    // Old generated answers are deliberately excluded. Prior user turns only resolve pronouns.
    const history=messages.slice(1).reverse().map(m=>Array.from(read(m)).slice(0,120).join(''));
    if(Buffer.byteLength(JSON.stringify(answerMessages(query,history,[])))>9000)fail('invalid_message',422);
    const retrievalQuery=history.length?history.join('\n')+'\n当前问题：'+query:query;
    await heartbeat(lease);
    const embedding=embeddingGateway();
    const meteredEmbedding={...embedding,embed:async (...args:Parameters<typeof embedding.embed>)=>{
      const operation='query:'+lease.jobId+':'+lease.token;
      await withTenantTransaction(lease.enterpriseId,async tx=>{
        await runContext(tx,lease);
        await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,measurement_kind)
          values(${lease.enterpriseId},${lease.runId},${operation},'query_embedding','unavailable')`);
      });
      const result=await embedding.embed(...args);
      if(result.usage)await withTenantTransaction(lease.enterpriseId,tx=>tx.execute(sql`update app.assistant_usage_records
        set quantity=${result.usage!.inputTokens},input_tokens=${result.usage!.inputTokens},measurement_kind='observed',updated_at=now(),version=version+1
        where enterprise_id=${lease.enterpriseId} and operation_key=${operation} and category='query_embedding'`));
      return result;
    }};
    const retrieved=deps.retriever?null:await retrieveKnowledge(String(context.run.conversation_id),lease.actor,retrievalQuery,Number(context.run.knowledge_epoch),meteredEmbedding);
    const diagnostic=retrieved?.diagnostic;
    const candidates=retrieved?retrieved.evidence.filter(e=>e.professional?.applicability.status!=='not_applicable')
      :await deps.retriever!.retrieve(lease.actor,retrievalQuery,Number(context.run.knowledge_epoch));
    const evidence:Evidence[]=[];
    for(const e of candidates) {
      // Only reject near-unrelated vectors here. The selector judges answerability
      // across the authorized semantic/lexical shortlist, including lower-scoring paraphrases.
      if(e.similarity!==undefined && e.similarity<0.3)continue;
      const prefix=Array.from(e.text).slice(0,600).join('');
      const end=Math.max(prefix.lastIndexOf('。'),prefix.lastIndexOf('！'),prefix.lastIndexOf('？'),prefix.lastIndexOf('\n'));
      const snippet={...e,text:Array.from(e.text).length>600?(end<0?'':prefix.slice(0,end+1)):e.text};
      if(!snippet.text)continue;
      if(Buffer.byteLength(JSON.stringify(answerMessages(query,history,[...evidence,snippet])))<=9000)evidence.push(snippet);
    }
    await withTenantTransaction(lease.enterpriseId,async tx=>{
      await runContext(tx,lease);
      const contextDiagnostic=diagnostic?{...diagnostic,candidates:diagnostic.candidates.map(c=>{
        const included=evidence.find(e=>e.ref.id===c.ref.id);return {...c,contextIncluded:!!included,contextChars:included?Array.from(included.text).length:0};
      })}:undefined;
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,input_summary,source_refs,status)
        values(${lease.enterpriseId},${lease.runId},${Number(context.job.attempts)*10},'retrieval','knowledge.search.v1',1,
        ${JSON.stringify({queryChars:query.length,candidateCount:candidates.length,promptVersion:'extractive-selection-v5-scoped-intent',knowledgeStatus:'ready',diagnostic:contextDiagnostic})}::jsonb,
        ${JSON.stringify(evidence.map(e=>({ref:e.ref,hash:e.hash})))}::jsonb,'succeeded')`);
    });
    if(!evidence.length) {await completeAnswer(lease,insufficientAnswer,[],null,followup);return;}
    await heartbeat(lease);
    const model=deps.model ?? textGateway(lease,evidence);
    stage='model';
    if(deps.model)await markProviderStarted(lease,evidence);
    // Preserve the existing output ceiling across configured providers. The compact
    // response schema does not depend on their differing reasoning-token accounting.
    const output=await model.generate({enterpriseId:lease.enterpriseId,owner:{kind:'assistant_run',runId:BigInt(lease.runId)},messages:answerMessages(query,history,evidence),maxTokens:2048});
    returned=true;
    if(output.usage && (!Number.isSafeInteger(output.usage.inputTokens) || !Number.isSafeInteger(output.usage.outputTokens) || output.usage.inputTokens<0 || output.usage.outputTokens<0))fail('invalid_model_answer',502);
    // Record the completed invocation even when output validation or later authorization rejects delivery.
    await withTenantTransaction(lease.enterpriseId,async tx=>{
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,provider_attempt_id,input_summary,status)
        values(${lease.enterpriseId},${lease.runId},${Number(context.job.attempts)*10+1},'model',${output.attemptId || null},'{"promptVersion":"extractive-selection-v5-scoped-intent"}','succeeded')`);
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,provider_attempt_id,operation_key,category,quantity,measurement_kind,input_tokens,output_tokens)
        values(${lease.enterpriseId},${lease.runId},${output.attemptId || null},${'answer:'+lease.runId},'tokens',${output.usage?output.usage.inputTokens+output.usage.outputTokens:null},${output.usage?'observed':'unavailable'},${output.usage?.inputTokens ?? null},${output.usage?.outputTokens ?? null}) on conflict do nothing`);
    });
    await completeAnswer(lease,parseSelection(output.text,evidence),evidence,output.attemptId || null,followup);
  }catch(e){
    // An explicit payment rejection is a known failure, not an ambiguous timeout.
    // Keep usage/cost unreconciled: this error is not a provider billing receipt.
    const paymentRejected=stage==='model' && e instanceof AiProviderError && e.code==='HTTP_402';
    try{await failRun(lease,paymentRejected?'provider_payment_required':e instanceof AssistantError?e.code:stage==='model'?'model_unavailable':'retrieval_unavailable',returned || paymentRejected);}catch(error){if(!(error instanceof AssistantError && error.code==='context_changed'))throw error;}
  }
}
