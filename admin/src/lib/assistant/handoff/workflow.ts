import { Command } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, requireCapability, type ActorContext } from '../contracts';
import { idempotent } from '../core/conversation';
import { reviewCheckpointer, reviewGraph, withReviewLock } from '../core/review-graph';
import { customerSources } from '../requirements/service';
import { HandoffService, handoffReviewApproval } from './service';
import { stageHandoffProposal } from './proposal';

type Action = 'request' | 'cancel' | 'end';
type WriteResult = Awaited<ReturnType<HandoffService['customerWrite']>> & {
  reviewWorkflow?: 'langgraph';
  receipt?: { effect: string; operation: Action; originRequestId: string | null;
    currentRequestId: string | null; text: string };
};
type Binding = { kind: 'review' | 'existing'; proposalId: string; digest: string; action: Action;
  inputHash: string; sourceHash: string; epoch: number; version: number; revision: number;
  requestId: string | null; state: string | null };
const workflow = (c: Row) => {
  const e = c.entry_snapshot as Row;
  return e.requirementReviewMode === true && e.requirementWorkflow === 'langgraph';
};
const state = (c: Row) => (c.entry_snapshot as Row).handoff as { requestId: string; state: string } | undefined;

export class HandoffWorkflow {
  readonly service: HandoffService;
  constructor(readonly actor: ActorContext, private readonly hooks: {
    afterPause?: () => Promise<void>; afterWrite?: () => Promise<void>;
  } = {}) {
    requireCapability(actor, 'assistant.chat.self');
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden',403);
    this.service = new HandoffService(actor);
  }
  private scoped<T>(conversationId: string, write: boolean,
    work: (repo: AssistantRepository, c: Row, settings: Row) => Promise<T>) {
    id(conversationId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx,this.actor), settings = await repo.settings(write);
      const c = await repo.conversation(conversationId);
      if (c.purpose !== 'customer_consultation') fail('assistant_capability_forbidden',403);
      return work(repo,c,settings!);
    });
  }
  private authorized(conversationId: string) {
    return this.scoped(conversationId,true,async (_repo,c) => {
      if (!workflow(c) || c.status !== 'open' || (c.entry_snapshot as Row).retentionRedacted) fail('context_changed');
    });
  }
  async customerRead(conversationId: string) {
    const data = await this.service.customerRead(conversationId);
    const enabled = await this.scoped(conversationId,false,async (_repo,c) => workflow(c));
    return { ...data, ...(enabled ? { reviewWorkflow: 'langgraph' as const } : {}) };
  }
  /** Model-facing proposal only: no consent, phone or execution inputs. */
  async propose(conversationId: string, action: 'request' | 'cancel') {
    await this.authorized(conversationId);
    const current = await this.service.customerRead(conversationId);
    if(action==='request' && current.handoff && ['waiting','active'].includes(current.handoff.state))return {
      action,effect:'existing' as const,writesBusinessState:false,currentState:current.handoff.state,text:'已有接待请求，当前状态保持不变。',
    };
    if(action==='cancel' && (!current.handoff || ['cancelled','ended'].includes(current.handoff.state)))return {
      action,effect:'existing' as const,writesBusinessState:false,currentState:current.handoff?.state || 'none',text:'当前没有待取消的接待请求。',
    };
    const proposal=await this.scoped(conversationId,true,(repo,c,settings)=>stageHandoffProposal(repo,c,settings,action));
    return { action, effect: 'proposal' as const, writesBusinessState: false,
      proposal,
      currentState: current.handoff?.state || 'none',
      confirmationEntry: `/packages/assistant/chat/chat?conversationId=${conversationId}`,
      text: action === 'request' ? '接待提案已备好，尚未提交接待、接通或预约，也没有分享手机号。'
        : '取消接待的提议已备好；接待状态尚未改变，需求保持原样。' };
  }
  private begin(conversationId: string, requestKey: string, input: Row) {
    return this.scoped(conversationId,true,async (repo,c,settings) => {
      if (!workflow(c) || c.status !== 'open' || (c.entry_snapshot as Row).retentionRedacted) fail('context_changed');
      return await idempotent(repo.tx,this.actor,'handoff-review:'+conversationId,requestKey,input,async () => {
        const h = state(c), action = String(input.action) as Action;
        const fulfilled = action === 'request' ? h && ['waiting','active'].includes(h.state)
          : !h || ['cancelled','ended'].includes(h.state);
        if (!fulfilled && Number(c.version) !== input.expectedVersion) fail('version_conflict');
        const source = await customerSources(repo,this.actor.enterpriseId,conversationId);
        const binding = { action, inputHash:fingerprint(input), sourceHash:source.hash,
          epoch:Number(settings.knowledge_epoch), version:Number(c.version), revision:Number(c.context_revision),
          requestId:h?.requestId || null, state:h?.state || null };
        return { ...binding, kind:fulfilled?'existing':'review', proposalId:randomUUID(), digest:fingerprint(binding) };
      }) as Binding;
    });
  }
  private thread(conversationId: string, proposalId: string) {
    return `handoff:${this.actor.enterpriseId}:${conversationId}:${proposalId}`;
  }
  private async currentReceipt(conversationId: string, binding: Binding) {
    const current = await this.service.customerRead(conversationId), h = current.handoff;
    const text = !h ? '当前没有待处理的接待请求。' : h.state === 'waiting'
      ? '接待请求已提交，等待企业接待；尚未接通或预约。' : h.state === 'active'
        ? h.ownerAvailable === false ? '当前接待人暂不可用，你可以结束接续回到小K' : '接待人员已接入本次咨询。'
        : h.state === 'cancelled' ? '本次接待请求已取消，需求保留。' : '本次接待已结束。';
    return { ...current, reviewWorkflow:'langgraph' as const,
      receipt:{ effect:binding.kind==='existing'?'existing':h?.state || 'none',
        operation:binding.action, originRequestId:binding.requestId,
        currentRequestId:h?.requestId || null, text } };
  }
  async customerWrite(conversationId: string, requestKey: string, input: Row): Promise<WriteResult> {
    const enabled = await this.scoped(conversationId,false,async (_repo,c) => workflow(c));
    if (!enabled) return this.service.customerWrite(conversationId,requestKey,input);
    key(requestKey);
    if (!['request','cancel','end'].includes(String(input.action))
      || Object.keys(input).some(k=>!['action','consent','contactConsent','phone','recipientId','leadId','archiveConsent','mediaConsent','expectedVersion'].includes(k))
      || !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion)<1
      || (input.action==='request' && input.consent!==true)) fail('invalid_message',422);
    const binding = await this.begin(conversationId,requestKey,input);
    if (binding.kind==='existing') return this.currentReceipt(conversationId,binding);
    const body = { ...input }; delete body.expectedVersion;
    return withReviewLock(this.actor,conversationId,async () => {
      await this.authorized(conversationId);
      const graph = reviewGraph({ kind:'handoff_'+binding.action,
        authorize:()=>this.authorized(conversationId), errorCode:'handoff_write_indeterminate', afterWrite:this.hooks.afterWrite,
        apply:async (_proposalId,digest,d) => {
          if (digest!==binding.digest || d.inputHash!==fingerprint(input) || d.inputHash!==binding.inputHash) fail('idempotency_conflict');
          await this.service.customerWrite(conversationId,d.requestKey,body,async (repo,c) => {
            const source = await customerSources(repo,this.actor.enterpriseId,conversationId), settings=await repo.settings(true), h=state(c);
            if (!workflow(c) || source.hash!==binding.sourceHash || Number(settings!.knowledge_epoch)!==binding.epoch
              || Number(c.version)!==binding.version || Number(c.context_revision)!==binding.revision
              || (h?.requestId || null)!==binding.requestId || (h?.state || null)!==binding.state) fail('context_changed');
          },undefined,handoffReviewApproval);
          return binding.action==='request' ? d.requestKey : binding.requestId!;
        } });
      const config={configurable:{thread_id:this.thread(conversationId,binding.proposalId)}};
      let snapshot=await graph.getState(config);
      if (!snapshot.values.proposalId) {
        await graph.invoke({proposalId:binding.proposalId,digest:binding.digest,decision:null,summaryId:null,status:'pending'},config);
        snapshot=await graph.getState(config);
      }
      if(snapshot.values.digest!==binding.digest)fail('context_changed');
      if(snapshot.next.length) {
        if(this.hooks.afterPause)await this.hooks.afterPause();
        await graph.invoke(snapshot.values.decision?null:new Command({resume:{approve:true,requestKey,restoreConsent:false,inputHash:binding.inputHash}}),config);
      }
      const complete=await graph.getState(config);
      if(complete.next.length || complete.values.status!=='applied')fail('context_changed');
      return this.currentReceipt(conversationId,{...binding,requestId:String(complete.values.summaryId)});
    });
  }
  async forget(conversationId: string, proposalIds: string[]) {
    await this.service.customerRead(conversationId);
    for(const proposalId of proposalIds)await reviewCheckpointer().deleteThread(this.thread(conversationId,proposalId));
  }
}
