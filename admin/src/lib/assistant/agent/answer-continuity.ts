import { fail } from '../contracts';
import type { SynthesisAnswer, SynthesisSource } from './synthesis';
import { affirmedNeedOccupancy } from './need-occupancy';

type CurrentUse = { room: string; status: 'known'; sourceId: string; value: string; occupancySpecified: boolean } | { room: string; status: 'unavailable' };
/** Authorized source keys plus the existing reply protocol. This is a reading
 * aid, not another fact store, citation source, save receipt or permission. */
export function synthesisAnswerFocus(sources: SynthesisSource[]) {
  const rooms = new Map<string, { room: string; uses: SynthesisSource[]; unavailable: boolean }>();
  for (const source of sources) {
    const m = source.material;
    if (m?.ref.type !== 'customer_need' || !m.need) continue;
    const key = JSON.stringify([m.leadId, m.roomName]);
    const room = rooms.get(key) || { room: m.roomName, uses: [], unavailable: false };
    if (m.need.field === 'use' && !room.uses.some(s => s.material!.ref.id === m.ref.id)) room.uses.push(source);
    if (m.need.interpretation?.currentFactId === null) room.unavailable = true;
    rooms.set(key, room);
  }
  const currentUses = [...rooms.values()].flatMap<CurrentUse>(({ room, uses, unavailable }) => {
    if (uses.length === 1) {
      const source = uses[0], need = source.material!.need!;
      return [{ room, status: 'known' as const, sourceId: source.sourceId, value: need.value,
        occupancySpecified: affirmedNeedOccupancy(need.value) !== null }];
    }
    return unavailable || uses.length > 1 ? [{ room, status: 'unavailable' as const }] : [];
  });
  return { authority: 'source_reading_aid_only' as const, currentUses,
    knowledgeSourceIds: [...new Set(sources.filter(s => s.kind === 'knowledge').map(s => s.sourceId))],
    responseRules: {
      format: '最多6段，每段最多4条引用；按事实主题分段，不把需求、设备、知识、图纸、阶段挤在一段。保留支持当前更正和正式版本的必要原文。不重复建议或待核实前缀，不承诺一次就能定准。',
      knownUse: '已明确的人数直接沿用，不再要求客户继续说明、补充或确认同一人数；解释已更正需求时实际引用对应当前use原话，事项状态或正式版本不能代替该原话。当前用途与同房间正式版原文确有差异时，同段说明双方具体值与差异、分别引用原话；仅分列人数或等待对象不算解释差异，不改写正式决定。人数改变不推定设备或插座数量应减少。',
      professionalWhy: '承接专业原因时，结合本轮相关企业依据和项目实况解释，引用真正支持原因的知识原文及其条件；不退化为只报事项状态。无相关依据就如实说明，不机械引用。',
      queryGaps: '缺项就地限定本轮可用资料，例如“本轮未取得现场尺寸或坐标，本次不能据此定点”；不把查询缺项改写成现场没有量测或尚不能施工。团队图纸关联只说明这条核对记录，不概括房间整体进度。继续核对的原因按企业核对要求及团队实际待核对记录解释。',
      delivery: '在原聊天补充只保存在本咨询，不自动共享或送达团队；需要人工时沿原接续流程，不追加每轮分享或转人工的追问。',
      telephone: '没有询问联系方式时不附加电话说明；缺号码只影响电话入口，原聊天和既有人工接续不等待电话配置。',
    } };
}

/** An observed continuation cited the formal version and issue state while
 * describing a private correction. Require its own current original, including
 * equivalent authorized aliases; neither another room nor the old version can
 * stand in for that original. This covers expressed occupancy corrections. */
export function assertCorrectedUseCitation(answer: SynthesisAnswer, sources: SynthesisSource[]) {
  const focus = synthesisAnswerFocus(sources);
  for (const use of focus.currentUses) {
    if (use.status !== 'known' || !use.occupancySpecified) continue;
    const original = sources.find(s => s.sourceId === use.sourceId)!;
    if (!original.material?.need?.supersedes) continue;
    const occupancy = affirmedNeedOccupancy(use.value);
    if (!occupancy || !answer.segments.some(s => s.basis === 'evidence' && s.text.includes(occupancy)
      && (focus.currentUses.length === 1 || Boolean(use.room && s.text.includes(use.room)))
      && /更正|沿用|用途补充|当前(?:需求|用途)|(?:你|您).{0,12}(?:需求|办公)/.test(s.text))) continue;
    const aliases = sources.filter(s => s.material?.ref.type === 'customer_need' && s.material.ref.id === original.material!.ref.id
      && s.material.ref.version === original.material!.ref.version && s.material.leadId === original.material!.leadId
      && s.material.roomName === use.room && s.material.need?.field === 'use' && s.material.need.value === use.value).map(s => s.sourceId);
    if (!answer.segments.some(s => s.citations.some(c => aliases.includes(c.sourceId) && c.quote.includes(occupancy)))) fail('invalid_model_answer', 502);
  }
}

/** Narrow regressions observed in persisted configured-model answers. This is
 * not a general semantic judge. Reject rather than rewrite a customer's facts
 * or silently spend another provider attempt on a semantic repair. */
export function assertAnswerContinuity(answer: SynthesisAnswer, sources: SynthesisSource[]) {
  const focus = synthesisAnswerFocus(sources), hasMaterials = sources.some(s => s.material || s.title === '本次材料查询范围与缺项');
  const rooms = [...new Set(sources.map(s => s.material?.roomName).filter((r): r is string => Boolean(r)))];
  for (const segment of answer.segments) {
    const text = segment.text;
    if (/最小待核实项|混合行|qualifiedBy|currentFactId|answerContext|responseRules|knowledgeSourceIds|occupancySpecified/.test(text)) fail('invalid_model_answer', 502);
    if (/原聊天.{0,10}(?:补充给|发给|告诉)(?:团队|设计师|负责人)/.test(text)) fail('invalid_model_answer', 502);
    if (!hasMaterials) continue;
    // Scope each assertion locally: a disclaimer in a later sentence cannot
    // turn an earlier assertion about reality into an authorized-query gap.
    for (const sentence of text.split(/[。！？!?\n]/).filter(Boolean)) {
      const scoped = /本轮|本次|这次|当前(?:可用|获权|授权|查询|资料|来源|证据)|(?:查询|资料|来源|证据)(?:中|里|内|范围)/.test(sentence);
      const missingMeasurement = /(?:位置|尺寸|点位).{0,16}(?:还|尚)?没有可量测依据|(?:人数|桌长|插座位置).{0,24}都还不能定|(?:尺寸|坐标|点位|位置).{0,20}(?:还|尚)?(?:没|没有).{0,2}(?:达到|落到).{0,4}可(?:执行|施工)/.test(sentence);
      const explicitReport = segment.citations.some(c => c.quote.includes(sentence.trim()) && sources.some(s => s.sourceId === c.sourceId
        && (s.material?.ref.type === 'site_record' || s.material?.ref.type === 'team_review') && s.text.includes(c.quote)));
      if (missingMeasurement && !scoped && !explicitReport) fail('invalid_model_answer', 502);
      const onlyDrawingStep = /(?:只|仅)(?:到|做到|完成到)了?\s*(?:图纸|参考图)(?:关联|核对|关联核对)(?:这一步|阶段)/.test(sentence);
      const recordSubject = /^(?:(?:这|该|本)(?:条|份))?(?:图纸|参考图)?(?:关联)?(?:核对)?记录/.test(sentence.trim());
      if (onlyDrawingStep && !recordSubject && !explicitReport) fail('invalid_model_answer', 502);
    }
    for (const use of focus.currentUses) {
      // Multiple rooms require an explicit subject; don't project one room's
      // known use onto a question about another room or an unbound new intent.
      if (focus.currentUses.length > 1 && (!use.room || !text.includes(use.room))) continue;
      if (use.status === 'unavailable') {
        if (segment.basis === 'advice' && /(?:常用|常态|平时|日常).{0,4}(?:一人|单人).{0,12}偶尔.{0,4}(?:两人|双人)/.test(text)) fail('invalid_model_answer', 502);
        continue;
      }
      if (/(?:我|小K)?不替(?:你|您)改需求/.test(text)) fail('invalid_model_answer', 502);
      if (!use.occupancySpecified) continue;
      // A team may still need to reconcile the formal version/site layout.
      // Only reject a request for the customer to confirm the known use again.
      const relevant = text.split(/[。！？!?；;\n]/).filter(s => !rooms.some(r => r !== use.room && s.includes(r)) || s.includes(use.room));
      if (relevant.some(s => /(?:(?:你|您|客户)(?:可以|需要|还需|应当|务必|请|能否|可否)|(?:请|麻烦|建议)(?:你|您|客户)).{0,16}(?:补充|确认|明确).{0,12}(?:办公人数|单人办公|双人办公|人数确认)/.test(s)
        || /(?:你|您).{0,12}(?:补充|提供).{0,12}(?:办公|人数).{0,8}(?:确认信息|确认)/.test(s)
        || /(?:单人办公|双人办公|办公人数)(?:这条)?(?:补充|需求).{0,12}(?:原聊天|本咨询).{0,8}(?:继续|再)(?:说明|补充|确认)/.test(s))) fail('invalid_model_answer', 502);
    }
  }
}
