import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSynthesisResponse } from '../agent/synthesis-review';
import { focusedSynthesisMessages, parseSynthesis, synthesisRepairFeedback, type SynthesisAnswer, type SynthesisSource } from '../agent/synthesis';
import type { ModelMessage } from '../contracts/model';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { sourceCitationCatalog } from '../agent/citation-catalog';

const current: SynthesisSource = { sourceId: 'need', kind: 'project', title: '客户当前需求', text: '书房单人办公。', material: {
  ref: { type: 'customer_need', id: 'fact', version: 'v2' }, hash: 'h', leadId: 'home', projectId: null, roomId: null, roomName: '书房',
  sourceMessageId: 'message', mediaIds: [], audience: 'customer_self', basis: 'owned_conversation', status: 'current', text: '书房单人办公。',
  need: { field: 'use', value: '单人办公', supersedes: 'old', authority: 'customer_statement', formalApproval: false } } };
const review = (text: string, sources: SynthesisSource[] = [current]) => reviewSynthesisResponse({ kind: 'synthesis',
  segments: [{ basis: 'uncertainty', text, citations: [] }] }, sources).map(i => i.code);

const unavailableUse: SynthesisSource = { ...current, sourceId: 'legacy', text: '书房书桌靠窗；书房偶尔双人办公', material: {
  ...current.material!, text: '书房书桌靠窗；书房偶尔双人办公', need: { ...current.material!.need!, field: 'desk',
    value: '书房书桌靠窗；书房偶尔双人办公', interpretation: { factId: 'legacy', field: 'use', currentFactId: null } } } };
const availabilityQuestion = '结合当前可用资料，现在书房办公人数还能确定吗，哪些需求仍可沿用？';

test('a rule containing the same digits cannot substantiate an explicit site measurement in that segment', () => {
  const rule: SynthesisSource = { sourceId: 'Krule', kind: 'knowledge', title: '参考手册',
    text: '平行管线间距不得小于300mm；暗盒距离大于100mm；横槽长度不大于1000mm。' };
  const site: SynthesisSource = { sourceId: 'Bsite', kind: 'project', title: '本人可见现场记录', text: '现场记录平行间距100 mm，适用条件仍须核实。' };
  const wrong: SynthesisSource = { ...site, sourceId: 'Bother', text: '现场记录平行间距200mm，尚未核对。' };
  const sources = [rule, site, wrong], before = JSON.stringify(sources);
  const answer = (text: string, selected: SynthesisSource[]) => JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text,
    citations: selected.map(source => ({ citationId: sourceCitationCatalog(source)[0].citationId })) }] });
  const text = '现场记录平行间距100mm，低于手册要求的300mm。';
  for (const selected of [[rule], [rule, wrong]]) {
    const bad = answer(text, selected);
    assert.throws(() => parseSynthesis(bad, sources), /ungrounded_response_scope/);
    const feedback = synthesisRepairFeedback(bad, sources);
    assert.equal(feedback?.code, 'ungrounded_response_scope');
    assert.match(feedback!.feedback, /misattributed_project_quantity/);
    assert.match(feedback!.feedback, /本轮已经返回/);
  }
  assert.doesNotThrow(() => parseSynthesis(answer(text, [rule, site]), sources));
  assert.doesNotThrow(() => parseSynthesis(answer('现场记录平行间距100毫米，低于手册要求的300mm。', [rule, site]), sources));
  assert.throws(() => parseSynthesis(answer('记录里的100cm低于这一要求。', [rule, site]), sources), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(answer('现场记录平行间距1000mm。', [rule, site]), sources), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(answer('现场抽测的管线间距低于手册要求。', [rule]), sources), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(answer('手册要求平行间距不得小于300mm。', [rule]), sources));
  assert.doesNotThrow(() => parseSynthesis(answer('如果现场记录平行间距100mm，仍应核对适用条件。', [rule]), sources));
  assert.equal(JSON.stringify(sources), before);
});

test('a saved customer intention cannot be retyped as a site measurement', () => {
  const need: SynthesisSource = { ...current, sourceId: 'Bneed', text: '客户表达：书房保留100mm作为假设尺寸。' };
  const answer = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '现场记录间距100mm。',
    citations: [{ sourceId: need.sourceId, quote: need.text }] }] });
  assert.throws(() => parseSynthesis(answer, [need]), /ungrounded_response_scope/);
});

test('one repair reports missing numeric and site-source support together instead of removing digits first', () => {
  const rule: SynthesisSource = { sourceId: 'Kmerged', kind: 'knowledge', title: '参考手册', text: '平行间距不得小于300mm。' };
  const site: SynthesisSource = { sourceId: 'Bmerged', kind: 'project', title: '已发布现场记录', text: '现场记录平行间距200mm，尚需核对。' };
  const make = (text: string, selected: SynthesisSource[]) => JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text,
    citations: selected.map(source => ({ citationId: sourceCitationCatalog(source)[0].citationId })) }] });
  const text = '记录里的200mm低于手册要求的300mm。';
  const bad = make(text, [rule]);
  assert.throws(() => parseSynthesis(bad, [rule, site]), /unsupported_model_commitment/);
  const feedback = synthesisRepairFeedback(bad, [rule, site]);
  assert.equal(feedback?.code, 'unsupported_model_commitment');
  assert.match(feedback!.feedback, /projectSourcePaths/);
  assert.match(feedback!.feedback, /numbersToSupportOrRemove/);
  assert.match(feedback!.feedback, /200/);
  assert.match(feedback!.feedback, /删去数字但保留/);
  assert.doesNotThrow(() => parseSynthesis(make(text, [rule, site]), [rule, site]));
  assert.throws(() => parseSynthesis(make('记录中的平行间距低于这一要求。', [rule]), [rule, site]), /ungrounded_response_scope/);
});
const reviewQuestion = (text: string, currentQuestion = availabilityQuestion, sources: SynthesisSource[] = [unavailableUse]) =>
  reviewSynthesisResponse({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text, citations: [] }] }, sources,
    { currentQuestion }).map(i => i.code);

test('unavailable occupancy is an evidence gap, not a new decision or an unsolicited request to repeat it', () => {
  for (const text of ['需要你重新明确一次人数，我再按新说法沿用。',
    '你直接告诉我书房平时是一个人还是两个人用。', '你可以在原聊天里补充一句书房平时是一个人还是偶尔两个人用。',
    '人数这一项你直接说清是单人还是偶尔两人。', '人数先按你实际使用习惯定下来。', '书房人数没定下来，会影响布置。']) {
    assert.deepEqual(reviewQuestion(text), ['reopened_unavailable_need'], text);
    assert.deepEqual(reviewQuestion(text, availabilityQuestion, []), [], text);
  }
  for (const text of ['书房办公人数这次无法确定；靠窗、电脑和台灯仍有依据。',
    '这次人数来源不可用，不代表你还没有确定需求。', '你无需重新明确人数，当前只说明这次无法确认。',
    '团队需要核对当前需求与此前共享版本的差异。', '此前共享的版本写的是双人办公，不能据此认定当前人数。']) {
    assert.deepEqual(reviewQuestion(text), [], text);
  }
});

test('unavailable occupancy cannot trigger speculative point reservation, but requested comparisons remain possible', () => {
  const advice = '人数没定之前，点位只能先按已知的电脑、台灯需求预留。';
  assert.deepEqual(reviewQuestion(advice), ['reopened_unavailable_need', 'unsolicited_unknown_plan']);
  assert.deepEqual(reviewQuestion('可以先按电脑和台灯安排插座点位。'), ['unsolicited_unknown_plan']);
  assert.deepEqual(reviewQuestion('靠窗的位置意向和电脑、台灯的需求可以先保留。'), []);
  for (const question of ['请比较书房单人和双人办公的布置取舍。', '如果书房改为双人办公，点位怎么考虑？',
    '人数暂时查不到，能否先按已知需求预留点位？']) {
    assert.deepEqual(reviewQuestion('可以先按电脑和台灯安排插座点位。', question), [], question);
  }
  assert.deepEqual(reviewQuestion('可以先按电脑和台灯安排插座点位。', '不要假设或比较人数，只说哪些需求仍可沿用。'), ['unsolicited_unknown_plan']);
});

test('observed conditional occupancy choices still reopen an unavailable preference without a customer request', () => {
  for (const text of ['你希望书房按哪种使用方式来定？', '人数定下来之前，插座和通道的排布依据还不完整。',
    '人数这一项定下来之前，点位和通道的最终核对还缺这一环。', '你方便时把书房平时几个人用说一句。']) {
    assert.deepEqual(reviewQuestion(text), ['reopened_unavailable_need'], text);
  }
  const advice = '如果书房确实要兼顾两人同时用电脑，最好在底盒固定前把人数和书桌大致尺寸一起定下来；如果只是偶尔有人陪坐，也可以按一人主用、预留一个备用插座来考虑。';
  assert.deepEqual(reviewQuestion(advice), ['unsolicited_unknown_plan']);
  assert.deepEqual(new Set(reviewQuestion(advice + '你希望书房按哪种使用方式来定？')),
    new Set(['unsolicited_unknown_plan','reopened_unavailable_need']));
  assert.deepEqual(reviewQuestion(advice, '请比较书房单人和双人办公的布置取舍。'), []);
  const transition = '如果人数暂时定不下来，可以先按单人使用预留、把双人并排的可能性留出余量，等人数明确后再定桌长和插座数量。';
  assert.deepEqual(new Set(reviewQuestion(transition)), new Set(['reopened_unavailable_need','unsolicited_unknown_plan']));
  assert.deepEqual(reviewQuestion(transition, '请比较书房单人和双人办公的布置取舍。'), []);
  assert.deepEqual(reviewQuestion('你不必把人数再说一遍。'), []);
  assert.deepEqual(reviewQuestion('此前共享的需求写的是双人办公，插座点位仍待核对。'), []);
  assert.deepEqual(reviewQuestion('如果两人办公，企业做法要求结合家具尺寸核对通道。'), []);
  assert.deepEqual(reviewQuestion('人数这一项要等按当前资料核对后才能定。'), ['reopened_unavailable_need']);
  assert.deepEqual(reviewQuestion('这次无法确认书房人数，不代表人数没定。'), []);
  assert.deepEqual(reviewQuestion('不代表人数没定。人数这一项要等资料核对后才能定。'), ['reopened_unavailable_need']);
});

test('unavailable current evidence cannot change what an earlier shared original actually marked as pending', () => {
  const text = '共享书房需求：靠窗双人办公，电脑和台灯，具体尺寸待核对。';
  const shared: SynthesisSource = { ...current, sourceId: 'shared', text, material: { ...current.material!, ref: { ...current.material!.ref, type: 'shared_need' }, text, need: undefined } };
  const run = (body: string, original = shared) => reviewSynthesisResponse({ kind: 'synthesis', segments: [{ basis: 'evidence', text: body,
    citations: [{ sourceId: original.sourceId, quote: original.text }] }] }, [unavailableUse, original], { currentQuestion: availabilityQuestion }).map(i => i.code);
  assert.deepEqual(run('此前共享的说明里，人数和尺寸都还标着待核对。'), ['misattributed_shared_need']);
  assert.deepEqual(run('此前共享版本写明双人办公，只对具体尺寸标待核对；这次不能据此确认当前私聊人数。'), []);
  const both = { ...shared, text: '共享书房需求：双人办公，人数和尺寸都待核对。' };
  assert.deepEqual(run('此前共享的说明里，人数和尺寸都还标着待核对。', both), []);
});

test('the model view gives a bounded availability reminder without changing originals, tool pairs or customer-requested comparisons', () => {
  const messages = (question: string, sources: SynthesisSource[] = [unavailableUse]): ModelMessage[] => [
    { role: 'system', content: [{ type: 'text', text: '原系统规则' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'trigger', text: question }) }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'query_materials', arguments: '{}' }] },
    { role: 'tool', callId: 'call', content: JSON.stringify({ synthesisSources: sources }) },
  ];
  const original = messages(availabilityQuestion), before = JSON.stringify(original);
  const view = focusedSynthesisMessages(original, 'trigger'); assert.equal(JSON.stringify(original), before);
  assert.equal(view[0].role, 'system'); assert.match(JSON.stringify(view[0]), /本轮回答范围/);
  assert.match(JSON.stringify(view[0]), /不是客户人数未定/);
  assert.doesNotMatch(JSON.stringify(view[0]), /currentFactId|单人办公|双人办公/);
  assert.deepEqual(view.find(m => m.role === 'assistant'), original[2]);
  assert.deepEqual(view.at(-1), original[1]);
  assert.equal(JSON.parse((view.find(m => m.role === 'tool') as { content: string }).content).synthesisSources[0].text, unavailableUse.text);
  assert.doesNotMatch(JSON.stringify(focusedSynthesisMessages(messages('请比较书房单人和双人办公的布置取舍。'), 'trigger')[0]), /本轮回答范围/);
  assert.doesNotMatch(JSON.stringify(focusedSynthesisMessages(messages(availabilityQuestion, [unavailableUse, current]), 'trigger')[0]), /本轮回答范围/);
});

test('unavailability review respects room scope, current replacements and explicit customer reentry', () => {
  const kitchen = { ...current, sourceId: 'kitchen', material: { ...current.material!, roomName: '厨房',
    need: { ...current.material!.need!, field: 'devices' as const, value: '洗碗机' } } };
  assert.deepEqual(reviewQuestion('请说明厨房使用人数。', availabilityQuestion, [unavailableUse, kitchen]), []);
  assert.deepEqual(reviewQuestion('需要你重新明确一次人数。', '请核对一下人数。', [unavailableUse, kitchen]), [], 'ambiguous rooms are not silently merged');
  assert.deepEqual(reviewQuestion('需要你重新明确一次人数。', availabilityQuestion, [unavailableUse, kitchen]), ['reopened_unavailable_need'], 'the current question explicitly selects the room');
  assert.deepEqual(reviewQuestion('所以人数这一项没定下来，会直接影响书桌。', availabilityQuestion, [unavailableUse, kitchen]), ['reopened_unavailable_need']);
  assert.deepEqual(reviewQuestion('点位只能先按已知的电脑、台灯需求预留。', availabilityQuestion, [unavailableUse, kitchen]), ['unsolicited_unknown_plan']);
  assert.deepEqual(reviewQuestion('人数没定下来。', availabilityQuestion, [unavailableUse, current]), [], 'an effective replacement supersedes the unavailable projection');
  assert.deepEqual(reviewQuestion('请在原聊天里说明书房办公人数。', '我想重新说明书房人数，你需要我补充什么？'), []);
});

const unassigned: SynthesisSource = { sourceId: 'waiting', kind: 'project', title: '原事项等待状态', text: '当前状态：仍待核对。等待对象：尚未分配有权负责人。',
  followup: { issueId: 'issue', revision: 2, projectId: 'project', room: '书房', field: 'use', status: 'awaiting_review',
    waitingFor: 'unassigned', ownerName: '', sourceMessageId: null, sourceFactId: null, lastProgress: '' } };

test('unassigned work does not establish real-world inactivity or remove the pending work', () => {
  for (const text of ['尚未分配有权负责人，也就是没有人在等。', '尚未分配负责人，不是已经有人在处理。', '书房用途补充没有待处理的事。']) {
    assert.deepEqual(review(text, [unassigned]), ['unsupported_work_absence'], text);
    assert.deepEqual(review(text, []), [], text);
  }
  for (const text of ['用途补充还在等分配处理人，当前仍待核对。', '未分配负责人不代表没有人在处理，也不代表无需处理。',
    '不是没有人在等，这条仍待分配。']) assert.deepEqual(review(text, [unassigned]), [], text);
  const cancelled = { ...unassigned, followup: { ...unassigned.followup!, status: 'cancelled' as const, waitingFor: 'none' as const } };
  assert.deepEqual(review('取消跟进后当前没有待执行安排。', [cancelled]), []);
});

test('pending verification cannot be expanded into an absolute inability to continue construction', () => {
  for (const text of ['点位没定下来，底盒固定和插座位置就没法往下走。', '现场还没落到可施工的程度。',
    '这次没查到现场尺寸，所以施工暂时无法继续。']) assert.deepEqual(review(text), ['unscoped_work_readiness'], text);
  for (const text of ['本轮还不能核实现场是否具备固定条件。', '如果点位未核对，底盒就不能固定。',
    '这次可用资料不足以判断现场能否施工。', '企业做法要求底盒固定前核对具体点位。']) assert.deepEqual(review(text), [], text);
  const reported: SynthesisSource = { sourceId: 'site', kind: 'project', title: '团队回传', text: '现场暂时无法继续施工，等待返工核对。' };
  assert.deepEqual(reviewSynthesisResponse({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '团队回传说明现场暂时无法继续施工，等待返工核对。',
    citations: [{ sourceId: 'site', quote: reported.text }] }] }, [reported]), [], 'an exact authorized site report can state its own limit');
});

test('observed missing-measurement claims require scope in that sentence, not a later disclaimer', () => {
  for (const text of ['具体安装位置和尺寸还没有可量测依据。', '人数和设备已经明确，缺的是可量测的现场尺寸与点位依据。',
    '现场没有可量测依据。这次可用资料不足。', '点位必须落到具体位置和尺寸上，而这一步目前还没有现场依据。']) assert.deepEqual(review(text), ['unscoped_measurement_gap']);
  for (const text of ['这次可用资料不足以核实现场尺寸。', '本轮缺少现场尺寸依据。',
    '本次可用资料还没有现场依据。', '团队回传说明尚无现场依据，仍待复核。',
    '团队回传说明尚无现场尺寸，仍待复核。', '如果没有现场尺寸，建议先量取。', '办公需求仍待核对，尚未分配负责人。']) assert.deepEqual(review(text), []);
});

test('already supplied occupancy cannot be refused or requested again; actual unknowns and team checks stay distinct', () => {
  for (const text of ['我不替你改需求。', '你可以直接在原聊天里补充单人办公的确认信息。', '你可以在原聊天里把单人办公这条补充继续说明。', '你确认一下办公人数。', '你再确认一下单人办公。']) {
    assert.deepEqual(review(text), ['repeated_known_need']);
    assert.deepEqual(review(text, []), []);
  }
  assert.deepEqual(review('按你前面更正的单人办公需求继续核对；正式版仍待团队核对现场尺寸。'), []);
  assert.deepEqual(review('需要团队确认人数与正式版的差异。'), []);
  for (const text of ['你当前这一版正式方案写的是“按双人办公补充电脑和台灯设备位，具体安装尺寸仍待现场核对”。',
    '你当前这一版正式方案按双人办公补充设备位。', '你之前已经补充了单人办公需求。',
    '你补充的“偶尔双人办公”已记在这条事项下。', '你确认过人数，当前仍按单人办公处理。']) assert.deepEqual(review(text), []);
  assert.deepEqual(review('还有一处差异要请团队核实：团队发来的这一版是按双人办公补充电脑和台灯设备位。'), []);
  assert.deepEqual(review('请设计师复核：正式版按双人办公补充设备位，与你的单人办公意向不一致。'), []);
  assert.deepEqual(review('你不用再补充单人办公的确认信息。'), []);
  // An older shared version is not a current private need.
  assert.deepEqual(review('请确认办公人数。', [{ ...current, material: { ...current.material!, ref: { ...current.material!.ref, type: 'shared_need' } } }]), []);
});

test('one rooms supplied use cannot prevent a different room question or guess an ambiguous room', () => {
  const kitchen: SynthesisSource = { ...current, sourceId: 'kitchen', material: { ...current.material!, roomName: '厨房',
    need: { ...current.material!.need!, field: 'devices', value: '洗碗机' } } };
  assert.deepEqual(review('请确认厨房使用人数。', [current, kitchen]), []);
  const otherUse = { ...kitchen, material: { ...kitchen.material!, need: { ...kitchen.material!.need!, field: 'use' as const, value: '双人使用' } } };
  assert.deepEqual(review('请确认人数。', [current, otherUse]), []);
});

test('review flags customer-facing internal wording without changing original source quotations', () => {
  for (const text of ['原记录属于混合行。', '最小待核实项：现场尺寸。']) assert.deepEqual(review(text), ['internal_wording']);
  const answer: SynthesisAnswer = { kind: 'synthesis', segments: [{ basis: 'evidence', text: '当前人数这次无法确认，靠窗意向仍可沿用。',
    citations: [{ sourceId: 'original', quote: '原记录属于混合行。' }] }] };
  const before = JSON.stringify(answer); assert.deepEqual(reviewSynthesisResponse(answer, []), []); assert.equal(JSON.stringify(answer), before);
});

const raw = (text: string, citations = [{ sourceId: 'need', quote: current.text }]) => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis: 'evidence', text, citations }] });
const badScope = raw('现场没有可量测依据。');
const scoped = raw('这次可用资料不足以核实现场尺寸；按你前面更正的单人办公需求继续核对。');

test('known wording defects use existing bounded repair only after source and commitment validation', () => {
  assert.throws(() => parseSynthesis(badScope, [current]), /ungrounded_response_scope/);
  const issue = synthesisRepairFeedback(badScope, [current]); assert.equal(issue?.code, 'ungrounded_response_scope');
  assert.match(issue!.feedback, /unscoped_measurement_gap/);
  assert.match(issue!.feedback, /segments\[0\]\.text/);
  assert.doesNotMatch(issue!.feedback, /segments\[1\]\.text/);
  assert.match(issue!.feedback, /这次可用资料还不足以核实现场尺寸/);
  assert.doesNotMatch(issue!.feedback, /repeated_known_need|internal_wording/);
  const correction = synthesisRepairFeedback(raw('我不替你改需求，也不把这一版当作已落实。'), [current]);
  assert.equal(correction?.code, 'ungrounded_response_scope');
  assert.match(correction!.feedback, /repeated_known_need/);
  assert.equal(synthesisRepairFeedback(scoped, [current]), null);
  assert.throws(() => synthesisRepairFeedback(raw('现场没有可量测依据。', [{ sourceId: 'unauthorized', quote: current.text }]), [current]), /invalid_model_citation/);
  assert.throws(() => synthesisRepairFeedback(raw('已经正式验收。现场没有可量测依据。'), [current]), /unsupported_model_commitment/);
});

test('the observed formal-version disclaimer receives an explicit rewrite without denying a saved private correction', () => {
  const formal: SynthesisSource = { sourceId: 'plan', kind: 'project', title: '团队这一版', text: '差异：按双人办公补充电脑和台灯设备位。' };
  const citations = [{ sourceId: 'need', quote: current.text }, { sourceId: 'plan', quote: formal.text }];
  const bad = raw('正式方案仍按双人办公补充设备位，与你当前的单人办公不一致，需要团队核实，我不替你改需求。', citations);
  const feedback = synthesisRepairFeedback(bad, [current, formal]);
  assert.equal(feedback?.code, 'ungrounded_response_scope');
  assert.match(feedback!.feedback, /我不替你改需求/);
  assert.match(feedback!.feedback, /私聊更正不自动修改团队这一版/);
  assert.equal(synthesisRepairFeedback(raw('当前意向沿用单人办公，私聊更正不自动修改团队这一版，差异仍需团队核实。', citations), [current, formal]), null);
});

test('response repair checkpoints once, cannot dispatch tools and still reauthorizes after a model response', async () => {
  const saved: AgentCheckpoint[] = []; let calls = 0, allowed = true;
  const ports: AgentRuntimePorts = {
    authorize: async () => { if (!allowed) throw Error('revoked'); },
    model: async (_turn, _messages, tools) => {
      calls++; if (calls > 1) assert.deepEqual(tools, []);
      return { text: calls === 1 ? badScope : scoped, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null };
    },
    tool: async () => { throw Error('repair must not dispatch a business tool'); },
    checkpoint: async state => { saved.push(structuredClone(state)); },
    validateFinal: async text => synthesisRepairFeedback(text, [current]),
  };
  const run = (resume?: AgentCheckpoint) => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '为什么还需核对？' }] }],
    tools: [{ name: 'lookup', description: 'read', parameters: { type: 'object' } }], ports, resume });
  const result = await run(); assert.equal(result.output?.text, scoped); assert.equal(calls, 2);
  const retry = saved.find(s => s.validationRepairs === 1 && !s.output)!; assert.ok(retry);
  ports.model = async () => { calls++; return { text: badScope, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null }; };
  await assert.rejects(run(retry), /ungrounded_response_scope/); assert.equal(calls, 3);
  ports.model = async () => { allowed = false; return { text: scoped, toolCalls: [], usage: null, finishReason: 'stop', providerRequestId: null }; };
  await assert.rejects(run(retry), /revoked/);
});
