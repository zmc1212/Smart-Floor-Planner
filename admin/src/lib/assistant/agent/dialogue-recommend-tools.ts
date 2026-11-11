import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '../contracts';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { synthesisContextAvailable } from './synthesis-sources';
import type { SynthesisContext } from './synthesis';
import { recommendDesigners, type DesignerSnapshot } from '@/lib/portfolio/designer-recommendation';
import { publicCandidates } from '@/lib/construction/public-read';
import { readMemory } from './memory';
import { recommendationRegion } from '../location/region';
import type { RagChatMessage } from '../fastgpt/native-rag';

/** Shared V2-surface `recommend_designers`/`recommend_public_sites`. Both the
 * FastGPT Agent V2 bridge and the XiaoK native executor dispatch the same
 * authorized implementations; the fixed step ids 2000/2010 and their kinds are
 * hard contracts of designerMessageProjection and core/discovery.ts. */

export type ToolReceipt = Record<string, unknown>;
/** Structural subset of DialogueToolRuntime; no import so the two surfaces stay
 * decoupled until the stage-2 wiring commit. */
export type RecommendToolRuntime = {
  lease: Lease;
  /** Executor protocol recorded on every step and receipt. */
  protocol: string;
  /** Revalidates lease, actor and policy on every call. */
  authorize: () => Promise<Awaited<ReturnType<typeof runContext>>>;
  context: SynthesisContext;
  messages: RagChatMessage[];
  /** Persisted fixed-step receipts re-served after a restart. The public-site
   * factory rebuilds its delivery outcome from the receipt at creation, so a
   * resumed run that never calls the tool again still replaces a contradictory
   * model draft (a saved "no authorized site here" must not become a request
   * for the customer's city). */
  recovered?: { designers?: ToolReceipt; publicSites?: ToolReceipt };
};

/** Server-authored list for the model to relay. It names only published sites
 * in the conversation's authorized region: no distance, no owner identity and
 * no claim that a public site is the customer's own project. */
export function nearbyPublicSitesText(region: { cityName: string; district?: string },
  items: Array<{ name: string; stageName?: string }>) {
  const place = region.cityName + (region.district ? '·' + region.district : '');
  if (!items.length) return `按你所在的位置（${place}）暂时没有已授权公开的工地；这不代表这一片没有在施工的工地。`;
  const list = items.slice(0, 3).map(item => item.name + (item.stageName ? `（${item.stageName}）` : '')).join('、');
  return `按你所在的位置（${place}）找到 ${items.length} 个已授权公开的工地：${list}。公开工地卡片随本条回复展示，可直接打开查看公开记录；只按城市/区县筛选，没有精确距离。`;
}

/** A located empty result is a complete answer, not a request for a city.
 *  Keep this receipt authoritative so the model cannot prepend a contradictory
 *  “需要先知道城市/区县” sentence after the tool has already resolved the place. */
export function nearbyPublicSitesReceipt(region: { cityName: string; district?: string },
  items: Array<{ name: string; stageName?: string }>) {
  return { status: items.length ? 'ready' : 'empty', tool: 'recommend_public_sites',
    text: nearbyPublicSitesText(region, items) };
}

/** No authorized region yet: an honest ask, and deliberately no step is
 * persisted — only a located result owns step 2010. */
export function publicSitesNeedRegionReceipt() {
  return { status: 'need_region', tool: 'recommend_public_sites',
    text: '还没有已获权的定位或明确的房屋城市，暂不能按附近筛选公开工地；可以请客户授权定位或补充所在城市。' };
}

/** Empty nearby results are delivered from the server receipt, never from a
 *  model draft that may ask for a location already known to the tool. */
export function publicSitesDeliveryText(modelText: string, receipt: { status: string; text: string } | undefined) {
  return receipt?.status === 'empty' ? receipt.text : modelText;
}
export type PublicSitesOutcome = { status: string; text: string };
/** Only a located result may override delivery; `need_region` never does. */
export function publicSitesOutcomeOf(receipt: ToolReceipt | undefined): PublicSitesOutcome | undefined {
  return receipt && (receipt.status === 'ready' || receipt.status === 'empty')
    ? { status: String(receipt.status), text: String(receipt.text) } : undefined;
}
/** Bridge delivery composition: an empty located result replaces the model text
 * and the model draft is not included at all. */
export function publicSitesDelivery(composed: { text: string; modelIncluded: boolean }, outcome: PublicSitesOutcome | undefined) {
  return { text: publicSitesDeliveryText(composed.text, outcome),
    modelIncluded: outcome?.status === 'empty' ? false : composed.modelIncluded };
}

/** The three authorized wordings: found N designers / missing city or direction
 * / no match. The credit decision lives in recommendDesigners, not here. */
export function designerRecommendationReceipt(count: number, needContext: boolean) {
  return { status: count ? 'ready' : 'empty', tool: 'recommend_designers',
    text: count ? `按当前公开条件找到${count}位设计师的公开作品，卡片随本条回复展示。`
      : needContext ? '还缺少房屋城市或设计方向，暂不能推荐；可以请客户补充所在城市或想要的风格。'
        : '没有找到符合条件的公开设计师作品。' };
}

/** `recommend_designers`: zero model arguments. Memoized once per run; a
 * persisted step 2000 is replayed verbatim across processes. Without items no
 * step is written — step 2000/kind is designerMessageProjection's contract. */
export function dialogueDesignerRecommendation(rt: RecommendToolRuntime) {
  let memo: Promise<ToolReceipt> | undefined = rt.recovered?.designers
    ? Promise.resolve(rt.recovered.designers) : undefined;
  return (): Promise<ToolReceipt> => memo ??= (async () => {
    await rt.authorize();
    const { receipt } = await withTenantTransaction(rt.lease.enterpriseId, async tx => {
      const current = await runContext(tx, rt.lease);
      if (!await synthesisContextAvailable(tx, rt.lease.actor, current.conversation, rt.context)) fail('context_changed');
      const cached = await one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps
        where enterprise_id=${rt.lease.enterpriseId} and run_id=${rt.lease.runId} and step_seq=2000
          and kind='agent_designer_result' and status='succeeded'`);
      if (cached) {
        const snapshot = cached.private_checkpoint as DesignerSnapshot | null;
        const saved = (cached.input_summary as Row).receipt as ToolReceipt | undefined;
        if (!snapshot?.items) fail('provider_outcome_unknown');
        return { receipt: saved && saved.status === 'ready' && saved.tool === 'recommend_designers'
          ? saved : designerRecommendationReceipt(snapshot.items.length, false) };
      }
      const recommendation = await recommendDesigners(tx, rt.lease.actor, current.conversation);
      const items = recommendation.needContext ? [] : recommendation.items;
      const receipt = designerRecommendationReceipt(items.length, !!recommendation.needContext);
      if (items.length) {
        const snapshot: DesignerSnapshot = {
          ...(recommendation.cityCode ? { cityCode: recommendation.cityCode } : {}),
          ...(recommendation.style ? { style: recommendation.style } : {}),
          ...(recommendation.layout ? { layout: recommendation.layout } : {}),
          items: items.map(item => ({ workId: item.work.id, versionId: item.work.versionId })),
        };
        await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,input_summary)
          values(${rt.lease.enterpriseId},${rt.lease.runId},2000,'agent_designer_result','succeeded',${JSON.stringify(snapshot)}::jsonb,
            ${JSON.stringify({ protocol: rt.protocol, tool: 'recommend_designers', count: items.length, receipt })}::jsonb)`);
      }
      return { receipt };
    });
    return receipt;
  })();
}

/** `recommend_public_sites`: zero model arguments. The authorized region comes
 * from current housing facts, the entry snapshot and the customer's latest
 * message; a located result owns step 2010 (core/discovery.ts depends on the
 * kind), `need_region` asks honestly and writes nothing. */
export function dialoguePublicSitesRecommendation(rt: RecommendToolRuntime) {
  let memo: Promise<ToolReceipt> | undefined = rt.recovered?.publicSites
    ? Promise.resolve(rt.recovered.publicSites) : undefined;
  // Restore the delivery state before any call: a recovered empty receipt is
  // authoritative even when the resumed graph goes straight to the final answer.
  let outcome: PublicSitesOutcome | undefined = publicSitesOutcomeOf(rt.recovered?.publicSites);
  const call = (): Promise<ToolReceipt> => memo ??= (async () => {
    await rt.authorize();
    const receipt = await withTenantTransaction(rt.lease.enterpriseId, async tx => {
      const current = await runContext(tx, rt.lease);
      if (!await synthesisContextAvailable(tx, rt.lease.actor, current.conversation, rt.context)) fail('context_changed');
      const cached = await one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps
        where enterprise_id=${rt.lease.enterpriseId} and run_id=${rt.lease.runId} and step_seq=2010
          and kind='agent_public_sites' and status='succeeded'`);
      if (cached) {
        // The checkpoint stores {region,count} only; without the persisted
        // receipt the exact delivery text is not rebuildable, so refuse.
        const checkpoint = cached.private_checkpoint as Row | null;
        const saved = (cached.input_summary as Row).receipt as ToolReceipt | undefined;
        if (!saved || !checkpoint?.region) fail('provider_outcome_unknown');
        return saved;
      }
      const memory = readMemory(current.conversation.entry_snapshot);
      const housing = memory.facts.filter(f => f.field === 'housing' && f.status === 'current').map(f => f.value).join(' ');
      const region = recommendationRegion(current.conversation.entry_snapshot, housing, rt.messages.at(-1)?.content || '');
      if (!region) return publicSitesNeedRegionReceipt();
      const items = (await publicCandidates(tx, rt.lease.enterpriseId, region.cityCode, region.district)).slice(0, 3);
      const receipt = nearbyPublicSitesReceipt(region, items);
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,source_refs,private_checkpoint,input_summary)
        values(${rt.lease.enterpriseId},${rt.lease.runId},2010,'agent_public_sites','succeeded',
          ${JSON.stringify(items.map(item => ({ siteId: item.id, versionId: item.versionId })))}::jsonb,
          ${JSON.stringify({ region, count: items.length })}::jsonb,
          ${JSON.stringify({ protocol: rt.protocol, tool: 'recommend_public_sites', count: items.length, receipt })}::jsonb)`);
      return receipt;
    });
    outcome = publicSitesOutcomeOf(receipt);
    return receipt;
  })();
  return { call, outcome: () => outcome };
}
