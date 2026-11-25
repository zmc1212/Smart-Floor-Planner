import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { samePublicRef, type PublicContent, type PublicContextRef } from '@/lib/construction/public-contract';
import { configuredPublicSiteGuide, publicGuideQuestion } from '@/lib/construction/public-guide';
import { publishedPublicMaterial } from '@/lib/construction/public-read';
import { AiProviderError } from '@/lib/ai/provider-types';
import { questionQuote } from '../core/conversation-interactions';
import { AssistantError, fail, fingerprint, isPublicAssistantScope, safeText, type Evidence, type KnowledgeRetriever, type MessageContent, type TextModelGateway } from '../contracts';
import { KnowledgeSearchUnavailable, retrieveKnowledge } from '../knowledge/retrieval';
import { answerMessages, insufficientAnswer, parseSelection } from '../knowledge/answer';
import { completeAnswer, completeGuidance, completeStageKnowledge, failRun, heartbeat, markProviderStarted, recoverKnowledgeAnswer, requeuePreDispatchModelFailure, runContext, type Lease } from './job-queue';
import { isStageChatQuestion, stageChatForConversation } from '@/lib/xiaok-v1/stage-chat-service';
import { classifyStageIntent } from '@/lib/xiaok-v1/stage-router';
import { specialistProtocol } from '../specialists/registry';
import { configuredGuidance, conversationGuidance, guidanceCommand, guidanceProgress } from '../requirements/guidance';
import { textGateway } from './model-gateway';
import { configuredEmbeddingProfile, embeddingGateway } from './embedding-gateway';
import { chatFirstProgress, defaultGuidance } from '../requirements/guidance';
import { needsDesignerSuggestion, designerSuggestion } from '../handoff/intent';
import { agentConfig } from '../agent/config';
import { processAgentAnswer } from '../agent/worker';
import { regenerateAnswer } from '../agent/answer-regeneration';
import { xiaokNativeExecutorProtocol, processNativeAgentAnswer } from '../agent/native-executor';
import { nativeSearchDependency, selectedNativeSearch } from '../agent/native-search';
import { configuredApplicationWebSearch } from '../agent/web-tool-runtime';
import { configuredWebSearchProvider } from '../web-search/provider';
import { reportCoordinationProtocol } from '../agent/report-question-plan';
import { runKnowledgeEnabled } from '../knowledge-policy';
import { fastGPTPreviewProtocol } from '../knowledge/fastgpt-retrieval';
import { processNativeRagAnswer } from '../fastgpt/rag-worker';
import { nativeAgentRuntimeBinding, nativeExecutorConfigurationIssue } from '../fastgpt/agent-v2/config';
import { publicHistoryScope } from '../agent/history';
import { companyPracticeRequested, knowledgeOriginalRequested } from '../agent/read-tool-input';
import { profileFieldLabels, profileRecallKind, renovationLeadId, renovationProfileRecall } from '../requirements/renovation-profile';
import { readMemory } from '../agent/memory';

type Dependencies={retriever?:KnowledgeRetriever;model?:TextModelGateway};
const requirementRecapRequested = (text: string) => /回顾|总结.*(?:需求|想法)|(?:需求|想法).*总结|整理一下|记了哪些想法|记住了什么/.test(text);

function completePublicGuideOpening(lease: Lease, ref: PublicContextRef) {
  return completeGuidance(lease, async (tx, { conversation }) => {
    const active = (conversation.entry_snapshot as Row).activePublicSite as PublicContextRef | undefined;
    if (!samePublicRef(active, ref)) fail('context_changed');
    const settings = await one(tx, sql`select guidance_config from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId}`);
    const guide = configuredPublicSiteGuide(settings?.guidance_config);
    if (!guide.enabled) fail('context_changed');
    const material = await publishedPublicMaterial(tx, lease.enterpriseId, ref.siteId, ref.versionId);
    if (!material) fail('public_site_unavailable', 404);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,input_summary)
      values(${lease.enterpriseId},${lease.runId},1003,'agent_public_context','succeeded',
      ${JSON.stringify([{ ...ref, contentHash: String(material.version.content_hash) }])}::jsonb,
      ${JSON.stringify({ protocol: 'public-site-guide-v1', current: ref })}::jsonb)`);
    return publicGuideQuestion(guide, material.version.content as PublicContent);
  }, 'construction.public.guide');
}

async function tryRenovationProfileRecap(lease: Lease, context: Awaited<ReturnType<typeof runContext>>) {
  if (lease.actor.principal.kind !== 'user' || context.conversation.purpose !== 'customer_consultation'
    || context.run.purpose !== 'reply' || context.run.trigger_kind !== 'user_message' || context.job.provider_started_at
    || !renovationLeadId(context.conversation.entry_snapshot as Row)) return null;
  return completeGuidance(lease, async (tx, current) => {
    const message = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${lease.enterpriseId}
      and conversation_id=${String(current.conversation.id)} and id=${String(current.run.trigger_message_id)}`);
    const content = message?.content as MessageContent | undefined;
    if (!content || content.blocks.some(block => block.type !== 'text')) return null;
    const question = safeText(content);
    if (!requirementRecapRequested(question) || !/装修画像|这套房.*(?:需求|想法)|已确认.*(?:需求|想法)/u.test(question)) return null;
    const result = await renovationProfileRecall(tx, lease.actor, current.conversation);
    if (!result) return null;
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs)
      values(${lease.enterpriseId},${lease.runId},1,${profileRecallKind},'succeeded',${JSON.stringify(result.ref)}::jsonb)`);
    const lines = result.profile.fields.map(field => profileFieldLabels[field.key] + '：'
      + (field.value.length > 180 ? field.value.slice(0, 180) + '…' : field.value));
    return '这套房已确认的装修需求：\n' + lines.join('\n') + '\n完整内容可在「装修需求」中查看。';
  });
}

async function tryRequirementGuidance(lease: Lease, context: Awaited<ReturnType<typeof runContext>>) {
  const { conversation, job, run } = context;
  const entry = conversation.entry_snapshot as Row;
  if (lease.actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation'
    || run.purpose !== 'reply' || run.trigger_kind !== 'user_message' || job.provider_started_at
    || entry.activePublicSite || entry.requirementReviewMode === true
    || ['reference_content', 'reference_unavailable', 'portfolio_content', 'public_site_entry'].includes(String(entry.kind))
    || (run.policy_snapshot as Row).reportContextVersion !== undefined) return null;
  const guidance = conversationGuidance(entry);
  if (!guidance) return null;
  const userId = lease.actor.principal.userId;
  // Read the live switch and write the reply under the same settings lock.
  return completeGuidance(lease, async (tx, current) => {
    if (current.job.provider_started_at) return null;
    const policy = current.run.policy_snapshot as Row;
    const runtime = policy.agentRuntime as Row | undefined;
    if (runtime?.protocol === xiaokNativeExecutorProtocol) {
      const config = agentConfig(policy.agent);
      const bound = nativeAgentRuntimeBinding(lease.enterpriseId);
      if (!config || !bound || bound.binding !== runtime.binding || nativeExecutorConfigurationIssue(config)) return null;
    }
    const settings = await one(tx, sql`select guidance_config from app.assistant_enterprise_settings where enterprise_id=${lease.enterpriseId}`);
    if (!configuredGuidance(settings?.guidance_config).enabled) return null;
    const trigger = await one<{ id: string; content: MessageContent }>(tx, sql`select id::text, content
      from app.assistant_messages where enterprise_id=${lease.enterpriseId} and conversation_id=${String(conversation.id)}
        and id=${String(run.trigger_message_id)} and user_id=${userId} and author_kind='user'`);
    if (!trigger || trigger.content.blocks.some(block => block.type !== 'text')) return null;
    const text = safeText(trigger.content);
    if (!guidanceCommand(text)) return null;

    const turns = readMemory(current.conversation.entry_snapshot).facts.filter(fact => fact.status === 'current')
      .map(fact => ({ id: fact.sourceMessageId, text: fact.quote }));
    turns.push({ id: trigger.id, text });
    return guidanceProgress(guidance, turns).reply;
  });
}

export async function processAnswer(lease:Lease,deps:Dependencies={}) {
  let returned=false;
  let regeneration=false;
  let stage:'retrieval'|'model'='retrieval';
  try {
    const context=await withTenantTransaction(lease.enterpriseId,tx=>runContext(tx,lease));
    const policy = context.run.policy_snapshot as Row;
    if (isPublicAssistantScope(lease.actor)) {
      if ((policy.agentRuntime as Row | undefined)?.protocol !== xiaokNativeExecutorProtocol)
        fail('assistant_capability_forbidden', 403);
      await processNativeAgentAnswer(lease);
      return;
    }
    if (context.run.purpose === 'reply.regenerate') {
      regeneration = true;
      stage = 'model';
      await regenerateAnswer(lease, () => { returned = true; });
      return;
    }
    if (context.run.purpose === 'public.site.intro' && policy.publicSiteGuideOpening) {
      await completePublicGuideOpening(lease, policy.publicSiteGuideOpening as PublicContextRef);
      return;
    }
    if (await tryRenovationProfileRecap(lease, context)) return;
    // Let a configured consultation interpret the current message through its
    // saved runtime before stage-template vocabulary can intercept it.
    const configuredConsultation = context.conversation.purpose === 'customer_consultation'
      && Boolean(policy.agentRuntime || policy.nativeRag || policy.agent);
    // I7.2: an owner's ordinary stage question is answered from the current
    // project stage inside the original C01 conversation. A visitor watching a
    // public site has no own project: that turn must keep the public-context
    // route so the withdrawn source is revalidated before delivery.
    if (lease.actor.principal.kind === 'user' && context.run.purpose === 'reply'
      && context.run.trigger_kind === 'user_message'
      && !configuredConsultation
      && !(context.conversation.entry_snapshot as Row).activePublicSite
      && ['customer_consultation', 'construction_followup'].includes(String(context.conversation.purpose))) {
      const userId = lease.actor.principal.userId;
      const question = await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        const message = await one(tx, sql`select content,seq from app.assistant_messages where enterprise_id=${lease.enterpriseId}
          and conversation_id=${String(context.run.conversation_id)} and id=${String(context.run.trigger_message_id)}`);
        if (!message) return null;
        const text = safeText(message.content as Parameters<typeof safeText>[0]);
        if (runKnowledgeEnabled(policy) && (companyPracticeRequested(text) || knowledgeOriginalRequested(text))) return null;
        if (!isStageChatQuestion(text)) return null;
        if (classifyStageIntent(text) === 'clarification') {
          if ((context.conversation.entry_snapshot as Row).activePublicSite) return null;
          if (policy.specialist === specialistProtocol) {
            const previous = await one(tx, sql`select content from app.assistant_messages where enterprise_id=${lease.enterpriseId}
              and conversation_id=${String(context.run.conversation_id)} and seq<${String(message.seq)}
              and author_kind='user' and user_id=${userId} order by seq desc limit 1`);
            if (previous && !isStageChatQuestion(text, [safeText(previous.content as Parameters<typeof safeText>[0])])) return null;
          }
        }
        return text;
      });
      if (question) {
        const completed = await completeStageKnowledge(lease, tx =>
          stageChatForConversation({ tx, enterpriseId: lease.enterpriseId, runId: lease.runId,
            conversationId: String(context.run.conversation_id), userId, question,
            actor: lease.actor, knowledgeEpoch: Number(context.run.knowledge_epoch) }));
        if (completed) return;
      }
    }
    // The run snapshot names its executor protocol; dispatch is exact and an
    // unknown protocol fails closed instead of entering another orchestrator.
    const agentRuntime = (policy.agentRuntime as Row | undefined)?.protocol !== undefined ? policy.agentRuntime as Row : undefined;
    if (agentRuntime) {
      if (agentRuntime.protocol === xiaokNativeExecutorProtocol) {
        if (!await tryRequirementGuidance(lease, context)) await processNativeAgentAnswer(lease);
        return;
      }
      fail('assistant_capability_forbidden', 403);
    }
    if (policy.nativeRag) { await processNativeRagAnswer(lease); return; }
    const agent = agentConfig(policy.agent);
    if ((agent || runKnowledgeEnabled(policy)) && await tryRequirementGuidance(lease, context)) return;
    const privateStaffReport = policy.reportCoordination === reportCoordinationProtocol
      && lease.actor.principal.kind === 'admin' && context.conversation.purpose === 'construction_followup'
      && context.run.purpose === 'reply' && lease.actor.capabilities.includes('assistant.followup.self');
    const staffPreview = policy.staffKnowledgePreview === fastGPTPreviewProtocol && lease.actor.principal.kind === 'admin'
      && context.conversation.purpose === 'knowledge_preview' && lease.actor.capabilities.includes('assistant.preview.self');
    if (agent && (lease.actor.principal.kind === 'user' || privateStaffReport || staffPreview
      || context.conversation.purpose === 'project_collaboration' && context.run.purpose === 'site.question' && lease.actor.capabilities.includes('assistant.project.shared'))) {
      if (agent.tools && !agent.consultation && configuredApplicationWebSearch()) {
        await processAgentAnswer(lease, { applicationWeb: { provider: configuredWebSearchProvider() } });
        return;
      }
      const native=lease.actor.principal.kind==='user' && agent.tools?await selectedNativeSearch(agent):null;
      await processAgentAnswer(lease,native?{webSearch:nativeSearchDependency({
        enterpriseId:lease.enterpriseId,runId:lease.runId,search:native})}:{}); return;
    }
    if(context.run.trigger_kind!=='user_message')fail('assistant_capability_forbidden',403);
    if ((context.conversation.entry_snapshot as Row).activePublicSite) fail('assistant_model_configuration_invalid', 503);
    const historyScope = publicHistoryScope(context.conversation, false);
    const { messages, quote } = await withTenantTransaction(lease.enterpriseId, async tx => {
      await runContext(tx, lease);
      const messages = await rows(tx,sql`select m.* from app.assistant_messages m join app.assistant_messages trigger on trigger.enterprise_id=m.enterprise_id
        and trigger.conversation_id=m.conversation_id where m.enterprise_id=${lease.enterpriseId} and trigger.id=${String(context.run.trigger_message_id)}
        and m.conversation_id=${String(context.run.conversation_id)} and m.seq<=trigger.seq and m.author_kind in ('user','admin')
        and (m.id=trigger.id or ${historyScope}) order by m.seq desc limit 3`);
      const quote = messages[0] ? await questionQuote(tx, lease.actor, context.conversation, messages[0]) : null;
      return { messages, quote };
    });
    if(!messages.length || String(messages[0].id)!==String(context.run.trigger_message_id))fail('context_changed');
    const read=(m:Row)=>safeText(m.content as Parameters<typeof safeText>[0]);
    const query=read(messages[0]);
    if (needsDesignerSuggestion(query)) { await completeGuidance(lease, designerSuggestion); return; }
    if (requirementRecapRequested(query)) {
      const turns = await withTenantTransaction(lease.enterpriseId, async tx => {
        await runContext(tx, lease);
        return rows(tx, sql`select m.id,m.content from app.assistant_messages m where m.enterprise_id=${lease.enterpriseId}
          and m.conversation_id=${String(context.run.conversation_id)} and m.author_kind='user' and ${historyScope} order by m.seq desc limit 200`);
      });
      const fields = chatFirstProgress(defaultGuidance, turns.reverse().map(m => ({ id: String(m.id), text: read(m) }))).fields;
      const labels = { housing: '房屋', household: '居住', style: '风格', budget: '预算', timeline: '时间', room: '房间想法' };
      const lines = Object.entries(labels).filter(([k]) => fields[k as keyof typeof fields]?.text)
        .map(([k, label]) => label + '：' + fields[k as keyof typeof fields].text);
      await completeGuidance(lease, lines.length ? '目前记下的想法：\n' + lines.join('\n') + '\n想改哪里，直接告诉我就好。' : '还没有足够的信息可以回顾，你可以先说说想法。');
      return;
    }
    if (!runKnowledgeEnabled(policy)) fail('assistant_disabled', 403);
    const followup: string | undefined = undefined;
    // Old generated answers are deliberately excluded. Prior user turns only resolve pronouns.
    const history = messages.slice(1).filter(m => String(m.id) !== quote?.id).reverse().map(m => Array.from(read(m)).slice(0,120).join(''));
    if (quote) history.push('本轮引用的原话：\n' + Array.from(quote.text).slice(0, 300).join(''));
    if(Buffer.byteLength(JSON.stringify(answerMessages(query,history,[])))>9000)fail('invalid_message',422);
    const retrievalQuery=history.length?history.join('\n')+'\n当前问题：'+query:query;
    await heartbeat(lease);
    const meteredEmbedding={get profile(){return configuredEmbeddingProfile();},embed:async (...args:Parameters<ReturnType<typeof embeddingGateway>['embed']>)=>{
      const embedding=embeddingGateway();
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
    const knowledgeStatus=diagnostic?.profileId==='0' && !candidates.length ? 'not_ready' : 'ready';
    const evidence:Evidence[]=[];
    for(const e of candidates) {
      // Only reject near-unrelated vectors here. The selector judges answerability
      // across the authorized semantic/lexical shortlist, including lower-scoring paraphrases.
      if(diagnostic?.provider!=='BAILIAN_RAG' && e.similarity!==undefined && e.similarity<0.3)continue;
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
      const originals = diagnostic ? evidence.map(item => candidates.find(original => original.ref.id === item.ref.id)!) : undefined;
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,input_summary,source_refs,private_checkpoint,status)
        values(${lease.enterpriseId},${lease.runId},${Number(context.job.attempts)*10},'retrieval','knowledge.search.v1',1,
        ${JSON.stringify({queryChars:query.length,candidateCount:candidates.length,promptVersion:'extractive-selection-v5-scoped-intent',knowledgeStatus,diagnostic:contextDiagnostic,
          ...(diagnostic ? { knowledgeContextHash: fingerprint(diagnostic.context) } : {})})}::jsonb,
        ${JSON.stringify(evidence.map(e=>({ref:e.ref,hash:e.hash})))}::jsonb,${originals ? JSON.stringify(originals) : null}::jsonb,'succeeded')`);
    });
    if(knowledgeStatus==='not_ready' && context.conversation.purpose==='knowledge_preview') fail('retrieval_unavailable',503);
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
    const recovery = !regeneration && stage === 'model' && !returned ? await recoverKnowledgeAnswer(lease, e) : null;
    if (recovery?.completed) return;
    // An explicit payment rejection is a known failure, not an ambiguous timeout.
    // Keep usage/cost unreconciled: this error is not a provider billing receipt.
    const paymentRejected=stage==='model' && e instanceof AiProviderError && e.code==='HTTP_402';
    const code = recovery?.blocked ?? (paymentRejected ? 'provider_payment_required'
      : e instanceof AssistantError ? e.code : stage === 'model' ? 'model_unavailable' : 'retrieval_unavailable');
    const details = e instanceof KnowledgeSearchUnavailable ? { retrieval: e.diagnostic }
      : recovery ? { modelFailure: recovery.failure, fallbackBlocked: recovery.blocked ?? null } : undefined;
    if (await requeuePreDispatchModelFailure(lease, code, details)) return;
    try{await failRun(lease,code,returned || paymentRejected,details);}catch(error){if(!(error instanceof AssistantError && error.code==='context_changed'))throw error;}
  }
}
