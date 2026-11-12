import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { projectMessage } from '@/lib/assistant/knowledge/sources';
import { projectKnowledgeContextAvailable } from '@/lib/assistant/knowledge/applicability-context';
import { siteActionAcknowledgement } from './site-action-contract';

export function siteKnowledgeComparisonRequested(raw: string) {
  return /(?:企业|公司|咱们|我们的).{0,16}(?:工艺|标准|规范|要求)|施工手册/u.test(raw)
    && /对照|对比|相比|差异|不一致|哪里不同|还差/u.test(raw)
    && /现场|工地|项目|实际/u.test(raw);
}

/** Route only; questions never authorize a project mutation or a need write. */
export function siteKnowledgeQuestion(raw: string, intent: string, photoCount: number) {
  if (photoCount || !['query','clarify'].includes(intent) || siteActionAcknowledgement(raw)) return false;
  if (intent === 'query' && siteKnowledgeComparisonRequested(raw)) return true;
  if(/图纸|需求|原话|照片|记录|事项|这件事|在等谁/.test(raw))return false;
  // Project progress questions are answered from the plan/evidence projection,
  // never with general enterprise craft knowledge.
  if(/落后|延期|逾期|拖期|(?:进度|计划|节点).*(?:怎么样|如何|到哪|正常|提前)/.test(raw))return false;
  if(intent==='clarify' && /跟进|处理|转交|接手|负责|回传|回复|发布|方案|落实|关闭|解决|记下|关联/.test(raw))return false;
  return /企业|公司|工艺|标准|规范|手册/.test(raw) || !/资料/.test(raw);
}

/** Caller holds the same live project read scope used by the entire S04 page. */
export async function siteKnowledgeResponse(tx: PostgresTransaction, actor: ActorContext, conversation: Row, sourceId: string) {
  const run = await one(tx,sql`select r.*,exists(select 1 from app.assistant_quota_reservations q
      where q.enterprise_id=r.enterprise_id and q.run_id=r.id and q.status in ('held','reconciling')) as pending_cost
    from app.assistant_runs r where r.enterprise_id=${actor.enterpriseId} and r.conversation_id=${String(conversation.id)}
      and r.trigger_message_id=${sourceId} and r.purpose='site.question' order by r.id desc limit 1`);
  if(!run)return null;
  const base={intent:'query',media:[],citations:[],runId:String(run.id),status:run.status};
  if(['queued','running'].includes(String(run.status)))return {...base,text:'原问题已保留，正在查询企业知识…'};
  if(run.status!=='succeeded'||!run.output_message_id)return {...base,text:run.pending_cost
    ?'本次答疑结果仍待核对，原问题已保留，请稍后重新读取。'
    :'本次答疑未完成，原问题已保留，可以稍后重新提问。'};
  if(!await projectKnowledgeContextAvailable(tx,actor,conversation,String(run.id)))return {...base,text:'项目阶段已变化，原回答不再沿用。请按当前阶段重新提问。'};
  const message=await one(tx,sql`select * from app.assistant_messages where enterprise_id=${actor.enterpriseId}
    and conversation_id=${String(conversation.id)} and run_id=${String(run.id)} and id=${String(run.output_message_id)}`);
  if(!message)return {...base,text:'本次答疑结果暂不可用，请重新读取。'};
  const projected=await projectMessage(tx,actor,conversation,message);
  return projected.available ? {...base,text:safeText(message.content as Parameters<typeof safeText>[0]),citations:projected.citations}
    : {...base,text:'关联资料已撤回、过期或权限已变化，原回答不再沿用。请重新提问。'};
}
