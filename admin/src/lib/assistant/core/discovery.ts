import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, safeText } from '../contracts';

const browsing = /看看|看下|看一下|看一看|(?:想(?:先|再)?|能不能|能否|可以|可不可以|能|给我|带我|先|只)(?:去)?看(?:看|下|一下|一看)?|参观|围观|浏览|观摩|了解一下|(?:想|帮我)(?:先)?找|(?:^|请|帮我|给我|想|可以|能否|能不能)推荐/;
const site = /工地|施工现场|施工实况|施工直播|在建项目/;
const work = /设计师|设计工作室|设计室|作品/;
const ownSite = /(?:我家|自家|自己家|我的|自己的|本项目|这个项目)(?:的)?(?:工地|施工现场|施工直播)/;
const siteInformation = /(?:工地|施工现场)(?:的)?(?:装修|贴砖|铺砖|防水|施工|验收|保洁)*(?:规范|标准|要求|做法|方法|费用|报价|工具|合同)/;
/** "周围有什么工地" asks for a list without a browse verb. The place
 * qualifier keeps ordinary craft talk about sites out. */
const nearbyListing = /(?:附近|周围|周边|这边|本地|同城)[^，,。；;！？!?\n]{0,10}(?:有没有|有什么|有哪些|哪些|哪个|哪儿有|哪里有|几个)[^，,。；;！？!?\n]{0,6}(?:工地|施工现场|施工实况|在建项目)/;

/** Presentation only. Read a direct browsing request from the customer's turn. */
export function discoveryIntent(text: string) {
  let sites = false, works = false;
  const unquoted = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g, '');
  for (const segment of unquoted.split(/[，,。；;！？!?\n]|(?=但(?:是)?|还想|也想|只想)/)) {
    const clause = segment.trim();
    if (/不想|不要|不用|不需要|先不|别(?:看|推荐)|假如|假设|如果/.test(clause)) continue;
    if (/怎么|怎样|如何|为什么|要不要|该不该|多少钱|什么标准/.test(clause)) continue;
    if (nearbyListing.test(clause) && !ownSite.test(clause) && !siteInformation.test(clause)) sites = true;
    const action = browsing.exec(clause) || /有没有|有没|哪里有|哪儿有/.exec(clause);
    if (!action) continue;
    const target = clause.slice(action.index + action[0].length).trim();
    // “工地和设计师作品都想看看” puts the objects before the action.
    const objects = /^(?:吗|呢|吧)?$/.test(target) ? clause.slice(0, action.index) : target;
    sites ||= site.test(objects) && !ownSite.test(clause) && !siteInformation.test(objects);
    works ||= work.test(objects) && !/设计师(?:的)?(?:电话|微信|建议|收费)|设计师.{0,3}(?:聊|接手|联系|沟通)/.test(objects);
  }
  return { sites, works };
}

/** Use the persisted run link, including for a reply whose request is on another history page. */
export async function discoveryReplies(tx: PostgresTransaction, enterpriseId: string, conversationId: string, replyIds: string[]) {
  if (!replyIds.length) return new Map<string, { seq: string; text: string; intent: ReturnType<typeof discoveryIntent> }>();
  const requests = await rows(tx, sql`select r.output_message_id::text as reply_id, original.seq::text, original.content,
    exists(select 1 from app.assistant_run_steps s where s.enterprise_id=r.enterprise_id and s.run_id=r.id
      and s.kind='agent_public_sites' and s.status='succeeded') as public_sites
    from app.assistant_runs r join app.assistant_messages original on original.enterprise_id=r.enterprise_id
      and original.conversation_id=r.conversation_id and original.id=r.trigger_message_id and original.author_kind='user'
    where r.enterprise_id=${enterpriseId} and r.conversation_id=${conversationId} and r.status='succeeded'
      and r.purpose='reply' and r.trigger_kind='user_message'
      and r.output_message_id in (${sql.join(replyIds.map(replyId => sql`${replyId}`), sql`, `)})
      and not exists(select 1 from app.assistant_speech_assets a where a.enterprise_id=original.enterprise_id
        and a.message_id=original.id and a.deleted_at is not null)`);
  return new Map(requests.map(request => {
    const text = safeText(request.content as Parameters<typeof safeText>[0]);
    const intent = discoveryIntent(text);
    // A delivered public-site result is itself a browsing answer, even when the
    // customer's wording was not caught by the presentation matcher.
    return [String(request.reply_id), { seq: String(request.seq), text,
      intent: request.public_sites === true ? { ...intent, sites: true } : intent }] as const;
  }));
}

export async function discoveryRequest(tx: PostgresTransaction, enterpriseId: string, conversation: Row,
  replyId: string, kind: keyof ReturnType<typeof discoveryIntent>) {
  if (conversation.purpose !== 'customer_consultation') fail('assistant_resource_not_found', 404);
  const request = (await discoveryReplies(tx, enterpriseId, String(conversation.id), [replyId])).get(replyId);
  if (!request?.intent[kind]) fail('assistant_resource_not_found', 404);
  return request;
}
