import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';

const rule: SynthesisSource = { sourceId: 'Krule', kind: 'knowledge', title: '合成条款', text: '平行间距不得小于300mm，两遍涂层应交叉涂刷。' };
const site: SynthesisSource = { sourceId: 'Bsite', kind: 'project', title: '合成现场记录',
  text: '现场记录抽测淋浴区高度1500mm、台盆柜区域1000mm，平行间距100mm，交叉屏蔽两侧延伸长度未量测。' };
const status = '团队标记的当前节点：防水。当前阶段联系电话尚未配置。';
const state: SynthesisSource = { sourceId: 'Bstate', kind: 'project', title: '本轮实际项目状态',
  text: site.text.padEnd(390, '注') + '\n' + status };
const sources = [rule, site, state];
const citation = (source: SynthesisSource, index = 0) => ({ citationId: sourceCitationCatalog(source)[index].citationId });
const raw = (text: string, selected = [citation(rule)], basis = 'evidence') => JSON.stringify({ kind: 'synthesis',
  segments: [{ basis, text, citations: selected }] });

test('run983 nonnumeric claims about site-record coverage need the actual observation quotation', () => {
  const text = '现场记录只写了两个区域的抽测高度，没有记录上翻范围、涂刷遍数和表面状况。';
  for (const selected of [[citation(rule)], [citation(rule), citation(state, 1)]])
    assert.throws(() => parseSynthesis(raw(text, selected), sources), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(rule), citation(site)]), sources));
  assert.doesNotThrow(() => parseSynthesis(raw('下面拿手册和已发布现场记录做对照。'), sources));
});

test('current stage and phone facts require the selected actual-state excerpt in every basis', () => {
  for (const basis of ['evidence', 'advice', 'uncertainty']) for (const text of [
    '项目当前节点登记为防水，这只是阶段标记。', '团队当前标记的节点是防水。', '当前项目节点显示在防水阶段。', '阶段联系电话也尚未配置。',
  ]) {
    assert.throws(() => parseSynthesis(raw(text, [citation(state)], basis), sources), /ungrounded_response_scope/);
    assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(state, 1)], basis), sources));
  }
  const different = { ...state, sourceId: 'Bother', text: '团队标记的当前节点：水电。' };
  assert.throws(() => parseSynthesis(raw('团队当前节点是防水。', [citation(different)]), [...sources, different]), /ungrounded_response_scope/);
});

test('status repair points to already-authorized exact catalog options without accepting unknown IDs', () => {
  const answer = raw('团队当前节点是防水，阶段联系电话尚未配置。', [citation(state)]);
  const feedback = synthesisRepairFeedback(answer, sources)!;
  assert.match(feedback.feedback, /misattributed_project_status/);
  assert.ok(feedback.feedback.includes(sourceCitationCatalog(state)[1].citationId));
  assert.match(feedback.feedback, /candidateOnly/);
  const unknown = raw('团队当前节点是防水。', [{ citationId: 'Cunknown-not-authorized' }]);
  assert.throws(() => synthesisRepairFeedback(unknown, sources), /invalid_model_citation/);
});

test('status questions and generic stage explanations stay usable while adjacent actual findings remain checked', () => {
  for (const text of ['当前节点是什么，本次无法确认。', '当前节点是否是防水，本次无法确认。',
    '当前节点只是阶段标记，不能代替验收。', '本次无法确认当前节点和阶段电话入口是否可用。'])
    assert.doesNotThrow(() => parseSynthesis(raw(text, [], 'uncertainty'), []));
  assert.throws(() => parseSynthesis(raw('当前节点是什么？团队当前节点是防水。'), sources), /ungrounded_response_scope/);
});

test('run994 collective inconsistency cannot include explicitly unmeasured shielding', () => {
  const selected = [citation(rule), citation(site)];
  const text = '平行间距、同槽共盒、交叉屏蔽三项都出现了与手册做法不一致的地方，但交叉屏蔽两侧延伸长度未量测。';
  assert.throws(() => parseSynthesis(raw(text, selected), sources), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text.replace('不一致的地方', '不一致或无法判断的情况'), selected), sources));
});

test('v78 stage assertions match returned field values without depending on the linking verb', () => {
  for (const text of ['当前项目节点只显示处于防水阶段。', '当前项目节点只表示处在防水阶段。',
    '项目当前阶段仍停留在防水阶段。', '团队当前节点记录成了防水。']) {
    assert.throws(() => parseSynthesis(raw(text, [citation(state)]), sources), /ungrounded_response_scope/);
    assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(state, 1)]), sources));
  }
  for (const text of ['如果当前项目节点处在防水阶段，应核对试验安排。', '当前节点是否处于防水阶段，本次无法确认。'])
    assert.doesNotThrow(() => parseSynthesis(raw(text, [], 'uncertainty'), sources));
});

test('v78 qualitative comparison needs the rule in the same paragraph', () => {
  const text = '现场记录本身注明测点需复核，所以现在能说的是抽测点与手册数值有差距。';
  assert.throws(() => parseSynthesis(raw(text, [citation(site)]), sources), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(site), citation(rule)]), sources));
  assert.doesNotThrow(() => parseSynthesis(raw('下面拿手册与现场记录做对照。', [citation(rule)]), sources));
});

test('v78 construction-record gaps cannot be attributed to unrelated materials-query gaps', () => {
  const gaps: SynthesisSource = { sourceId: 'Bgaps', kind: 'project', title: '本次材料查询范围与缺项',
    text: '本轮待核对：这次咨询中对应的有效原话需求；已完成正式主户型；当前有效点位图及其对应房间。' };
  const text = '本次授权查询里，主卫没有提供涂刷完成的具体时间、保养起算点、蓄水试验记录和楼下检查结果。';
  assert.throws(() => parseSynthesis(raw(text, [citation(gaps)], 'uncertainty'), [...sources, gaps]), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(site)], 'uncertainty'), [...sources, gaps]));
  assert.doesNotThrow(() => parseSynthesis(raw('这次可用资料未提供正式主户型和点位图。', [citation(gaps)], 'uncertainty'), [...sources, gaps]));
  assert.doesNotThrow(() => parseSynthesis(raw('如果试验记录没有提供，建议先核对。', [], 'advice'), sources));
});

test('the available input can be incomplete without establishing a project record gap', () => {
  const text = '本次没有这间房的施工记录或验收结果可供核对，因此无法判断现在能否开工。';
  assert.doesNotThrow(() => parseSynthesis(raw(text, [], 'uncertainty'), [rule]));
  assert.throws(() => parseSynthesis(raw(text, [], 'uncertainty'), [rule, site]), /ungrounded_response_scope/);
  for (const statement of [
    '本次没有查到验收结果，现场没有做验收。',
    '这间房没有施工记录和验收结果。',
    text + '本次查询显示现场没有验收结果。',
  ]) assert.throws(() => parseSynthesis(raw(statement, [], 'uncertainty'), [rule]), /ungrounded_response_scope/);
});

test('v78 retaining a nonnumeric record claim still needs its record after adding state citations', () => {
  const observation: SynthesisSource = { ...site, text: site.text + '整改和验收均未完成。' };
  const all = [rule, observation, state];
  const text = '当前记录本身注明整改和验收均未完成，团队当前节点是防水。';
  assert.throws(() => parseSynthesis(raw(text, [citation(state, 1)]), all), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(observation), citation(state, 1)]), all));
});

test('single status repair identifies original per-paragraph selections without applying a union', () => {
  const original = raw('现场记录平行间距100mm，团队当前节点是防水。', [citation(site), citation(state)]);
  const before = JSON.stringify(sources), feedback = synthesisRepairFeedback(original, sources)!;
  assert.match(feedback.feedback, /selectedCitationContext/);
  assert.ok(feedback.feedback.includes(citation(site).citationId));
  assert.match(feedback.feedback, /保留.*原引用/);
  assert.equal(JSON.stringify(sources), before);
  assert.throws(() => parseSynthesis(original, sources), /ungrounded_response_scope/);
  const repaired = raw('现场记录平行间距100mm，团队当前节点是防水。', [citation(site), citation(state, 1)]);
  assert.doesNotThrow(() => parseSynthesis(repaired, sources));
});

test('run1019 question-valued construction fields cannot hide an actual missing-record assertion', () => {
  const gaps: SynthesisSource = { sourceId: 'Bgaps80', kind: 'project', title: '本次材料查询范围与缺项', text: '本轮待核对：原话需求、正式主户型、有效点位图。' };
  const text = '本次授权查询中，主卫防水完成的具体时间、保养是否满足手册要求、蓄水深度与水位记录、楼下检查记录都还没有资料。';
  assert.throws(() => parseSynthesis(raw(text, [citation(gaps)], 'uncertainty'), [...sources, gaps]), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(site)], 'uncertainty'), [...sources, gaps]));
  for (const question of ['本次无法确认保养记录是否缺失。', '如果保养记录没有提供，应先核对。'])
    assert.doesNotThrow(() => parseSynthesis(raw(question, [], 'uncertainty'), sources));
});

test('run1025 actual-state support cannot replace the retained trial/curing-record support', () => {
  const text = '团队标记的当前节点是防水，该阶段联系电话尚未配置；节点本身不能作为防水合格的依据，蓄水试验结果、保养起算时间和验收结论目前都没有可核对的记录。';
  const answer = raw(text, [citation(state, 1)], 'uncertainty');
  assert.throws(() => parseSynthesis(answer, sources), /ungrounded_response_scope/);
  assert.match(synthesisRepairFeedback(answer, sources)!.feedback, /misattributed_project_observation/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(state, 1), citation(site)], 'uncertainty'), sources));
});

test('a room-scoped answer cannot borrow another room record that is still authorized', () => {
  const material = (roomName: string) => ({ ref: { type: 'site_record' as const, id: '1', version: '1' }, hash: 'h', leadId: '1',
    projectId: '1', roomId: roomName === '厨房' ? '2' : '3', roomName, sourceMessageId: null, mediaIds: [],
    audience: 'customer_self' as const, basis: 'published_project_record' as const, status: 'current' as const, text: site.text });
  const kitchen: SynthesisSource = { ...site, sourceId: 'Bkitchen', title: '厨房记录', material: material('厨房') };
  const bathroom: SynthesisSource = { ...site, sourceId: 'Bbath', title: '卫生间记录', material: material('卫生间') };
  const all = [...sources, kitchen, bathroom];
  const text = '现场记录抽测淋浴区高度1500mm。';
  assert.throws(() => parseSynthesis(raw(text, [citation(kitchen)]), all, { currentRoom: '卫生间' }), /ungrounded_response_scope/);
  assert.match(synthesisRepairFeedback(raw(text, [citation(kitchen)]), all, { currentRoom: '卫生间' })!.feedback, /misattributed_project_room/);
  assert.doesNotThrow(() => parseSynthesis(raw(text, [citation(bathroom)]), all, { currentRoom: '卫生间' }));
});

test('repair retains selections only for affected paragraphs, without repeating unrelated correct selections', () => {
  const extra: SynthesisSource = { sourceId: 'Kextra80', kind: 'knowledge', title: '合成另一条件', text: '其他资料条件仍须核对。' };
  const first = JSON.parse(raw('团队当前节点是防水。', [citation(state)]));
  for (let i = 0; i < 5; i++) first.segments.push({ basis: 'advice', text: '其他资料条件仍须核对。', citations: [citation(extra)] });
  const feedback = synthesisRepairFeedback(JSON.stringify(first), [...sources, extra])!.feedback;
  assert.ok(feedback.includes('segments[0].citations'));
  assert.ok(!feedback.includes('segments[5].citations'));
  assert.ok(!feedback.includes(citation(extra).citationId));
});
