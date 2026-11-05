import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAgentReply } from '../agent/context';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { focusedSynthesisMessages, parseSynthesis, referUnsupportedSiteObservation, synthesisRepairFeedback, type SynthesisSource, type SynthesisSegment } from '../agent/synthesis';
import { reportCoordinationText } from '../agent/report-question-plan';

// Verbatim failing excerpts from preserved runs 938/939/943. The original
// reports in tmp/xiaok-source-integrity-merged-recovered-{a,b} remain immutable.
const rule: SynthesisSource = { sourceId: 'Krule', kind: 'knowledge', title: '参考手册', text:
  'd) 强、弱电管线平行布置，间距不得小于 300 mm；强弱电交叉布置时，须进行 弱电屏蔽处理（弱电线管包裹锡铂，两侧各超过强电线管外侧 150mm 以上）。 不得同槽、不得共用线盒，基层内严禁暗藏分线盒，盒与线管相接时应使用锁 母，强电与弱电的暗盒应分开敷设，一般距离应大于 100mm。' };
const site: SynthesisSource = { sourceId: 'Bsite', kind: 'project', title: '已发布现场记录', text:
  '厨房强弱电管线已布置，现场记录平行间距200mm，局部同槽并共用线盒，交叉处仅见一小段屏蔽包裹。\n交叉屏蔽两侧延伸长度未量测，整改和验收均未完成。' };
const unknownContact = '涂刷的具体完成时刻、保养是否已满、楼下是否已联系，本次资料里都没有记录；这些需要现场负责人核对后才能确定蓄水时间。';
const raw = (text: string, selected: SynthesisSource[], basis: SynthesisSegment['basis'] = 'evidence') => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis, text, citations: selected.map(source => ({ citationId: sourceCitationCatalog(source)[0].citationId })) }] });
const rejects = (text: string, selected: SynthesisSource[], code: string, sources = [rule, site]) => {
  const value = raw(text, selected);
  assert.throws(() => parseSynthesis(value, sources), /ungrounded_response_scope/);
  assert.match(synthesisRepairFeedback(value, sources)!.feedback, new RegExp(code));
};

test('run943 unknown-status question survives without suppressing any adjacent completion assertion', () => {
  for (const kind of ['general', 'vision', 'unavailable']) {
    assert.equal(parseAgentReply(JSON.stringify({ kind, text: unknownContact })), unknownContact);
    for (const action of ['已经联系', '联系完成', '已正式验收', '已付款', '预约成功']) {
      for (const text of [unknownContact + action + '。', '楼下是否已联系，' + action + '。', action + '，楼下是否已联系尚不清楚。']) {
        assert.throws(() => parseAgentReply(JSON.stringify({ kind, text })), /unsupported_model_commitment/);
      }
    }
  }
  for (const basis of ['evidence', 'advice', 'uncertainty'] as const) {
    assert.doesNotThrow(() => parseSynthesis(raw(unknownContact, [site], basis), [rule, site]));
    assert.throws(() => synthesisRepairFeedback(raw(unknownContact + '我已联系楼下。', [site], basis), [rule, site]), /unsupported_model_commitment/);
  }
});

test('a scoped status question only projects the queried predicate, including inside one clause', () => {
  for (const text of ['楼下是否已联系？本次尚未核实。', '楼下是否联系完成，本次尚未核实。', '是否已经正式批准，本次依据不能确认。'])
    assert.equal(parseAgentReply(JSON.stringify({ kind: 'general', text })), text);
  for (const text of ['楼下是否已联系而我已付款。', '是否已联系并已验收。', '我已联系，是否已批准尚不清楚。', '不是询问是否已联系，我已联系。'])
    assert.throws(() => parseAgentReply(JSON.stringify({ kind: 'general', text })), /unsupported_model_commitment/);
});

test('run938 nonnumeric site observation requires its own actual project source', () => {
  const text = '记录只看到一小段包裹、延伸长度未量测，所以现在无法判断是否满足两侧延伸要求。';
  rejects(text, [rule], 'misattributed_project_observation');
  assert.doesNotThrow(() => parseSynthesis(raw(text, [site, rule]), [rule, site]));
  const unrelated = { ...site, sourceId: 'Bother', text: '现场记录主卫基层待复核。' };
  rejects(text, [unrelated, rule], 'misattributed_project_observation', [rule, unrelated]);
  const need: SynthesisSource = { ...site, sourceId: 'Bneed', material: {
    ref: { type: 'customer_need', id: 'fact', version: 'v1' }, hash: 'h', leadId: 'home', projectId: null, roomId: null, roomName: '厨房',
    sourceMessageId: 'message', mediaIds: [], audience: 'customer_self', basis: 'owned_conversation', status: 'current', text: site.text,
    need: { field: 'use', value: '仅客户表达', supersedes: null, authority: 'customer_statement', formalApproval: false },
  } };
  for (const source of [{ ...site, kind: 'history' as const }, need])
    rejects(text, [source, rule], 'misattributed_project_observation', [rule, source]);
  assert.doesNotThrow(() => parseSynthesis(raw('如果记录只看到一小段包裹，仍应实测两侧延伸长度。', [rule]), [rule, site]));
  assert.doesNotThrow(() => parseSynthesis(raw('本次资料未提供延伸长度，不能判断现场是否满足要求。', [rule], 'uncertainty'), [rule, site]));
});

test('run940 describing a reference-to-record comparison does not claim an observation', () => {
  const title: SynthesisSource = { ...rule, text: '施工工艺标准 2.0' };
  const text = '先对齐口径：这份《施工工艺标准2.0》是参考手册，不是你们项目已采纳的合同标准；下面只是拿它和已发布的主卫现场记录做对照。';
  assert.doesNotThrow(() => parseSynthesis(raw(text, [title]), [title, site]));
  rejects('已发布的现场记录写的是局部同槽并共用线盒。', [rule], 'misattributed_project_observation');
});

test('run10408 cannot promote a site-record coordination instruction to a completed marking', () => {
  const completed = '设计师发来平面图二版，保留原有餐边柜的位置。';
  const pending = '现场只标记位置，等设计师核对后再确认点位。';
  const fixture = (id: string, completion: string): SynthesisSource => {
    const text = '客餐厅图纸二版交接\n本次完成：' + completion + '\n待沟通：' + pending;
    return { sourceId: id, kind: 'project', title: '已发布现场记录（客餐厅）', text, material: {
      ref: { type: 'site_record', id, version: '2' }, hash: id, leadId: '8235', projectId: '1927', roomId: '1',
      roomName: '客餐厅', sourceMessageId: '1', mediaIds: [], audience: 'customer_self', basis: 'published_project_record',
      status: 'current', text, siteCompleted: completion,
    } };
  };
  const coordination = fixture('Bcoordination', completed);
  const recorded = fixture('Brecorded', '现场已用纸胶带标记了餐边柜旁插座位置。');
  const answer = (text: string, source: SynthesisSource) => JSON.stringify({ kind: 'synthesis',
    segments: [{ basis: 'evidence', text, citations: [{ sourceId: source.sourceId, quote: source.text }] }] });
  const assertion = '现场仅标记了大致位置，尚未最终确认点位。';
  assert.throws(() => parseSynthesis(answer(assertion, coordination), [coordination, recorded]), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(answer('现场已标记但尚未确认点位。', coordination), [coordination]), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(answer(assertion, rule), [coordination, rule]), /ungrounded_response_scope/);
  assert.match(synthesisRepairFeedback(answer(assertion, coordination), [coordination, recorded])!.feedback, /misattributed_project_observation/);
  assert.doesNotThrow(() => parseSynthesis(answer('记录中的现场位置标记仍待沟通。', coordination), [coordination]));
  assert.doesNotThrow(() => parseSynthesis(answer('现场已标记了餐边柜旁插座位置。', recorded), [recorded]));
  const packet = JSON.stringify({ query: { domain: 'materials' }, synthesisSources: [coordination] });
  const projected = focusedSynthesisMessages([
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: '1', text: '图纸差异怎么处理？' }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'query_materials', arguments: '{}' }] },
    { role: 'tool', callId: 'read', content: packet },
  ], '1').find(message => message.role === 'tool');
  assert.ok(projected?.content);
  const projection = JSON.parse(projected.content).synthesisSources[0];
  assert.equal(projection.text, coordination.text);
  assert.equal(projection.material.siteCompleted, undefined);
  assert.equal(projection.material.hash, undefined);
  assert.equal(JSON.parse(packet).synthesisSources[0].material.siteCompleted, completed);

  const original = { ...rule, text: '签字前对照最新版平面图和点位图，按房间记录版本差异，把有疑问的位置交给设计师核对。' };
  const question = { currentQuestion: '设计师刚把新版图发我，签字前我先看哪些地方？' };
  const knowledge = JSON.parse(raw(original.text, [original])).segments[0];
  const observation = JSON.parse(raw('目前现场只标记了位置，等设计师核对后再确认点位。', [coordination])).segments[0];
  const advice = { basis: 'advice', text: '一般建议确认开关高度。', citations: [] };
  const mixed = (...segments: unknown[]) => JSON.stringify({ kind: 'synthesis', segments });
  const sources = [original, coordination];
  const saved = mixed(knowledge, observation, advice);
  assert.throws(() => parseSynthesis(saved, sources, question), /ungrounded_response_scope/);
  const result = referUnsupportedSiteObservation(saved, sources, question);
  assert.deepEqual(parseSynthesis(result, sources, question).segments, [
    parseSynthesis(mixed(knowledge), sources, question).segments[0],
    { basis: 'uncertainty', text: reportCoordinationText, citations: [] },
  ]);
  assert.equal(referUnsupportedSiteObservation(result, sources, question), result);
  assert.equal(referUnsupportedSiteObservation(saved, [coordination], question), saved);
  assert.equal(referUnsupportedSiteObservation(saved, [original], question), saved);
  for (const unchanged of [
    mixed(observation, advice),
    mixed({ ...knowledge, text: original.text + '还应预留30毫米。' }, observation),
    mixed(knowledge, observation, { ...advice, text: '我已联系楼下。' }),
    mixed(knowledge, observation, observation),
    mixed(knowledge, { ...observation, citations: [...observation.citations, ...knowledge.citations] }),
  ]) assert.equal(referUnsupportedSiteObservation(unchanged, sources, question), unchanged);
  const factual = mixed(knowledge, JSON.parse(raw('现场已标记了餐边柜旁插座位置。', [recorded])).segments[0]);
  assert.equal(referUnsupportedSiteObservation(factual, [...sources, recorded], question), factual);
});

test('run938/939 inferred mechanisms cannot acquire evidence status from a prescription', () => {
  for (const text of [
    '主要风险是强电对弱电信号的长期干扰，以及后期检修、开槽时两者互相牵连。',
    '同槽共盒会让强弱电在近距离长期并行，干扰更集中，也影响以后单独检修和更换。',
    '问题在于强弱电同槽共盒后，两路管线之间缺少物理分隔，后续穿线、检修时也容易互相干扰。',
  ]) {
    rejects(text, [rule, site], 'unsupported_evidence_mechanism');
    assert.doesNotThrow(() => parseSynthesis(raw(text, [], 'advice'), [rule, site]));
  }
  const explanation = { ...rule, sourceId: 'Kexplained', text: '分开敷设可减少信号干扰，便于后续检修。' };
  assert.doesNotThrow(() => parseSynthesis(raw('分开敷设可减少信号干扰，便于后续检修。', [explanation]), [explanation]));
  assert.doesNotThrow(() => parseSynthesis(raw('手册要求不得同槽、不得共用线盒。', [rule]), [rule, site]));
});

test('run939 contradictory compliance and unmeasured shielding fail with exact source quotations', () => {
  rejects('先说结论：厨房这条记录里，平行间距这一项按记录数值看是达标的，同槽共盒和交叉屏蔽这两项则与手册做法不符，需要负责人现场核对。记录本身也写明交叉屏蔽两侧延伸长度未量测、整改和验收均未完成，所以它只能作为观察线索，不能当作合格结论。',
    [site, rule], 'contradictory_measurement_comparison');
  rejects('交叉屏蔽与手册做法不符。', [rule, site], 'unmeasured_compliance_claim');
  rejects('平行间距200mm满足手册不小于300mm的要求。', [site, rule], 'contradictory_measurement_comparison');
  for (const text of ['记录中的平行间距200mm低于手册要求的300mm，适用条件仍须核实。',
    '交叉屏蔽两侧延伸长度未量测，不能判定其满足或不满足要求。', '如果交叉屏蔽范围不足，需要负责人现场核对。'])
    assert.doesNotThrow(() => parseSynthesis(raw(text, [rule, site]), [rule, site]));
});

test('bounded direct comparisons use the named metric, same unit and actual inequality without inventing calculations', () => {
  for (const [op, limit, value, wrong, correct] of [
    ['不得小于', '320', '210', '达标', '不达标'], ['不得大于', '180', '230', '符合要求', '不符合要求'],
    ['不得小于', '210', '210', '不达标', '达标'], ['大于', '210', '210', '符合要求', '不符合要求'],
  ]) {
    const k = { ...rule, text: '管路净距' + op + limit + 'mm。' };
    const b = { ...site, text: '现场记录管路净距' + value + 'mm。' };
    rejects('记录中的管路净距' + wrong + '。', [k, b], 'contradictory_measurement_comparison', [k, b]);
    assert.doesNotThrow(() => parseSynthesis(raw('记录中的管路净距' + correct + '，仍需核实适用条件。', [k, b]), [k, b]));
  }
  const before = JSON.stringify([rule, site]);
  assert.doesNotThrow(() => parseSynthesis(raw('手册要求平行间距不得小于300mm。', [rule]), [rule, site]));
  assert.equal(JSON.stringify([rule, site]), before);
});

test('one existing repair combines numeric, observation, mechanism and comparison failures', () => {
  const value = raw('记录里的平行间距200mm符合手册不小于300mm的要求。记录只看到一小段包裹。主要风险是信号干扰和后期检修困难。', [rule]);
  const feedback = synthesisRepairFeedback(value, [rule, site])!;
  assert.equal(feedback.code, 'unsupported_model_commitment');
  for (const code of ['misattributed_project_quantity', 'misattributed_project_observation', 'unsupported_evidence_mechanism'])
    assert.match(feedback.feedback, new RegExp(code));
  assert.match(feedback.feedback, /numbersToSupportOrRemove/);
  assert.match(feedback.feedback, /一次/);
  assert.throws(() => synthesisRepairFeedback(raw('主要风险是干扰。我已联系楼下。', [rule]), [rule, site]), /unsupported_model_commitment/);
});
