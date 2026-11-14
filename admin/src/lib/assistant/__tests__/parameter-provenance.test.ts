import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mentionsParameter, parameterEndorsementFeedback, unverifiedParameterEndorsements, userStatedParameters } from '../agent/parameter-provenance';
import { normalizeNativeCitationCarrier } from '../agent/native-citation-gate';
import { publishedSiteNote, publishedSiteRecordText } from '@/lib/construction/site-contract';
import { reviewSynthesisResponse } from '../agent/synthesis-review';
import { parseSynthesis } from '../agent/synthesis';
import { standardStatusClaims, unverifiedStandardStatus, type PublicStandard } from '../web-search/standards';
import type { SynthesisSource } from '../agent/synthesis';
import type { RagCitationSource } from '../fastgpt/native-rag';

test('user-stated quantities keep every bound and unit', () => {
  const parameters = userStatedParameters('师傅说管根上翻 250 mm，附加层做200-300mm，闭水24小时。');
  assert.deepEqual(parameters.map(item => item.values), [['250'], ['200', '300'], ['24']]);
  assert.equal(parameters[0].unit, 'mm');
  assert.equal(parameters[2].unit, '小时');
  assert.equal(mentionsParameter('做到250毫米', parameters[0]), true);
  assert.equal(mentionsParameter('做到0.25米', parameters[0]), false, 'unit conversion is not authorization');
});

test('an unverified master value cannot become a requirement', () => {
  const question = '师傅说卫生间管根上翻250mm，这样做行吗？';
  const issues = unverifiedParameterEndorsements('管根上翻应做到250mm，这是通用要求。', question, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'unsupported_user_value');
  assert.match(parameterEndorsementFeedback(issues), /尚未核实/);
  assert.match(parameterEndorsementFeedback(issues), /不能改称行业惯例/);
});

test('the same value is allowed when the segment cites an original that contains it', () => {
  const question = '师傅说卫生间管根上翻250mm，这样做行吗？';
  const quote = '管根防水附加层在地面一侧的宽度不应小于250mm。';
  assert.deepEqual(unverifiedParameterEndorsements('按原文，管根附加层宽度不小于250mm。', question, [quote]), []);
});

test('deleting the digits does not launder an endorsement of the master value', () => {
  const question = '师傅说卫生间管根上翻250mm，这样做行吗？';
  const issues = unverifiedParameterEndorsements('这个高度可以，按师傅说的做就行。', question, []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, 'indirect_endorsement');
});

test('an explicit unverified statement is not an endorsement', () => {
  const question = '师傅说卫生间管根上翻250mm，这样做行吗？';
  assert.deepEqual(unverifiedParameterEndorsements('师傅说的250mm尚未核实，不能作为企业标准。', question, []), []);
  assert.deepEqual(unverifiedParameterEndorsements('这个高度尚未核实，需要现场和设计确认。', question, []), []);
});

test('a question without a literal value cannot make a number user-provided', () => {
  assert.deepEqual(unverifiedParameterEndorsements('这个高度可以。', '卫生间管根怎么做？', []), []);
});

test('published record projection keeps the formal status and real pending facts', () => {
  const note = '本条为待人工核对的进展草稿，未发布、未批准。管根与地漏密封仍待核对。';
  assert.equal(publishedSiteNote(note), '管根与地漏密封仍待核对。');
  const text = publishedSiteRecordText({ title: '卫生间防水管根及地漏密封处理', roomId: '1', completed: '', pending: '',
    coordination: '', note }, '卫生间', 3);
  assert.match(text, /服务端正式状态：已核对发布（版本 3）/);
  assert.doesNotMatch(text, /草稿|未发布/);
  assert.match(text, /管根与地漏密封仍待核对/);
});

test('citation ids with provider homoglyphs normalize only to an issued id', () => {
  const issued = 'C9abc_def-1';
  const source: RagCitationSource = { nativeId: issued, origin: 'current', quote: '原文', evidence: {
    ref: { type: 'web_page', id: '1:1200:0', version: 'v' }, hash: 'v', text: '原文',
  } };
  const cyrillic = issued.replace('C', 'С');
  assert.equal(normalizeNativeCitationCarrier(`引用[${cyrillic}](CITE)。`, [source]), `引用[${issued}](CITE)。`);
  assert.equal(normalizeNativeCitationCarrier('[C-not-issued](CITE)。', [source]), '[C-not-issued](CITE)。');
  assert.equal(normalizeNativeCitationCarrier(`[${cyrillic}](CITE ${cyrillic})`, [source]), `[${issued}](CITE)`);
});

const publishedRecord = {
  sourceId: 'B1', kind: 'project' as const, title: '已发布现场记录（卫生间）',
  text: '服务端正式状态：已核对发布（版本 3）；不代表正式验收、费用或工期批准。\n卫生间防水管根及地漏密封处理',
  material: { ref: { type: 'site_record', id: '1', version: '3' }, basis: 'published_project_record', roomName: '卫生间' },
} as unknown as SynthesisSource;

test('a published record cannot be called an unpublished draft', () => {
  const answer = (text: string) => ({ kind: 'synthesis' as const, segments: [{ basis: 'advice' as const, text, citations: [] }] });
  const issues = reviewSynthesisResponse(answer('查到的两条现场记录还是待人工核对的草稿，尚未发布。'), [publishedRecord]);
  assert.deepEqual(issues.map(issue => issue.code), ['contradicted_published_record']);
  assert.deepEqual(reviewSynthesisResponse(answer('该记录不是草稿，已核对发布；管根密封仍待核对。'), [publishedRecord]), []);
});

test('“现行标准中不一致的，以本规范为准” is precedence, not a validity claim', () => {
  const notice: PublicStandard = { kind: 'publication_notice', id: 'GB55030-2022', name: '建筑与市政工程防水通用规范',
    level: 'national', status: 'unknown', effectiveAt: '2023-04-01' };
  const quote = '现批准《建筑与市政工程防水通用规范》为国家标准，编号为GB55030-2022，自2023年4月1日起实施。'
    + '现行工程建设标准中有关规定与本规范不一致的，以本规范的规定为准。';
  const text = '它是强制性工程建设规范，2023年4月1日起实施；现行其他标准中与该规范不一致的，以该规范为准。';
  assert.deepEqual(standardStatusClaims(text), []);
  assert.equal(unverifiedStandardStatus(text, [{ standard: notice, quote }], [notice]), false);
});

test('an explicit present-validity claim still needs a status original', () => {
  const notice: PublicStandard = { kind: 'publication_notice', id: 'GB55030-2022', name: '建筑与市政工程防水通用规范',
    level: 'national', status: 'unknown', effectiveAt: '2023-04-01' };
  const quote = '现批准《建筑与市政工程防水通用规范》为国家标准，编号为GB55030-2022，自2023年4月1日起实施。';
  assert.equal(unverifiedStandardStatus('GB55030-2022 目前仍然有效。', [{ standard: notice, quote }], [notice]), true);
});

test('a native project snapshot supports its own stage, record and photo-count facts', () => {
  const snapshot: SynthesisSource = { sourceId: 'Bstate', kind: 'project', title: '本人项目节点查询范围与缺项',
    text: '团队标记的当前节点：水电。\n团队已核对发布的现场记录：\n服务端正式状态：已核对发布（版本 4）；不代表正式验收、费用或工期批准。\n'
      + '卫生间防水管根及地漏密封处理\n施工部位：卫生间\n本次完成：卫生间防水管根和地漏密封已完成（据提供人原话）。\n'
      + '原话称附处理后的现场照片1张，但未提供图片像素。' };
  const draft = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', citations: [], text:
    '团队标记的当前节点仍是水电；卫生间有两条已核对发布的现场记录。一条记录写的是管根密封已完成，随附了1张照片；'
    + '另一条写的是管根与地漏密封仍待核对。两条都是服务端已核对发布的记录，不代表正式验收。' }] });
  const review = { currentQuestion: '我刚才说错了，是卫生间。做到哪一步了？', currentRoom: '卫生间',
    specialistAcceptance: true, projectSnapshotAuthoritative: true };
  assert.doesNotThrow(() => parseSynthesis(draft, [snapshot], review));
});

test('record version labels are metadata, not construction quantities', () => {
  const snapshot: SynthesisSource = { sourceId: 'Bstate', kind: 'project', title: '本人项目节点查询范围与缺项',
    text: '团队已核对发布的现场记录：\n服务端正式状态：已核对发布（版本 4）。\n原话称附处理后的现场照片1张。' };
  const draft = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', citations: [], text:
    '版本 3 的记录写的是管根密封待核对，版本 4 的记录写的是已完成，随附 1 张照片；两条都是已核对发布的记录。' }] });
  assert.doesNotThrow(() => parseSynthesis(draft, [snapshot], { currentQuestion: '卫生间做到哪一步了？',
    currentRoom: '卫生间', specialistAcceptance: true, projectSnapshotAuthoritative: true }));
});

test('an unavailable enterprise source cannot turn generic advice into a company rule', () => {
  const draft = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', citations: [], text:
    '关于本企业针对卫生间管根防水的具体规定，这次我没能取得企业内部资料，不能把我的说法当作公司规定。'
    + '从一般装修做法看，管根通常先做清理和封堵，再做附加层。' }] });
  assert.doesNotThrow(() => parseSynthesis(draft, [], { currentQuestion: '我们装修公司对卫生间管根做防水有什么明确要求吗？',
    specialistAcceptance: true, enterpriseUnavailable: true }));
  const wrong = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', citations: [], text:
    '我们公司规定卫生间管根附加层宽度不小于 250mm。' }] });
  assert.throws(() => parseSynthesis(wrong, [], { currentQuestion: '我们装修公司对卫生间管根做防水有什么明确要求吗？',
    specialistAcceptance: true, enterpriseUnavailable: true }), /unsupported_model_commitment|ungrounded_response_scope/);
});

test('CITE[id] is the same issued citation carrier after normalization', () => {
  const source: RagCitationSource = { nativeId: 'C9abc_def-1', origin: 'current', quote: '原文', evidence: {
    ref: { type: 'web_page', id: '1:1200:0', version: 'v' }, hash: 'v', text: '原文',
  } };
  assert.equal(normalizeNativeCitationCarrier('公告 CITE[C9abc_def-1]。', [source]), '公告 [C9abc_def-1](CITE)。');
});
