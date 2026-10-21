import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { modelCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { resolveSynthesisRepair } from '../agent/synthesis-repair';
import type { NeedFact } from '../agent/memory';

function material(id: string, text: string, type: 'customer_need' | 'formal_floorplan', field: NeedFact['field'] = 'other', value = text): SynthesisSource {
  return { sourceId: id, kind: 'project', title: type === 'formal_floorplan' ? '正式户型' : '本咨询客户原话', text,
    material: { ref: { type, id, version: fingerprint(text) }, hash: fingerprint(text), leadId: '1', projectId: null,
      roomId: null, roomName: '', sourceMessageId: null, mediaIds: [], audience: 'customer_self',
      basis: type === 'formal_floorplan' ? 'primary_plan' : 'owned_conversation', status: 'current', text,
      ...(type === 'customer_need' ? { need: { field, value, supersedes: null, authority: 'customer_statement' as const, formalApproval: false as const } } : {}) } };
}
const sources: SynthesisSource[] = [
  { sourceId: 'B-scope', kind: 'project', title: '本次材料查询范围与缺项', text: '本轮待核对：对应现场记录；有效点位图。缺项只表示本次授权查询未提供，不表示现实中未发生。' },
  material('B-storage', '请记下：书房需要收纳。', 'customer_need', 'other', '需要收纳'),
  material('B-living', '请记下：客厅保留阅读角。', 'customer_need', 'other', '保留阅读角'),
  material('B-desk', '更正：书房书桌改为靠内墙。', 'customer_need', 'desk', '靠内墙'),
  material('B-budget', '更正：全屋预算改为18万元。', 'customer_need', 'budget', '18万元'),
  material('B-plan', '合成主正式v4户型，非实机量测', 'formal_floorplan'),
];
const cite = (index: number) => ({ citationId: modelCitationCatalog(sources[index])[0].citationId });
const planDrafts = [
  '现有户型资料包含正式v4户型图（非实机量测），以及客户明确的原话需求记录，如书房需收纳、客厅保留阅读角、书桌靠内墙、全屋预算18万元等。',
  '现有户型资料为正式v4户型图（非实机量测），包含当前客户已确认的收纳需求（书房）、阅读角保留（客厅）、书桌靠内墙调整及18万元预算等明确意向。',
];
const adviceDrafts = [
  [
    '书房柔和照明建议采用‘主灯+辅助’组合：主灯选低色温（3000K-3500K）的吸顶灯或磁吸轨道灯，提供基础均匀照明；辅助层在书桌上方安装防眩射灯或灯带，阅读时亮度可调，避免眩光。',
    '若预算有限，可先做基础照明，后期再增加可调光台灯或局部灯带；色温统一（建议3000K-3500K）能营造柔和氛围，避免冷白光影响阅读专注度。',
  ],
  [
    '书房柔和照明建议采用‘基础照明+重点照明+氛围照明’三层搭配：基础层用3000K色温的300-400流明筒灯或吸顶灯，保证整体亮度；重点层在书桌上方或侧墙安装2700-3000K的轨道射灯或壁灯，聚焦阅读区域；氛围层可在床头或书架上方加一盏2700K的落地灯或壁灯，营造温馨感。',
    '灯具选择上，优先选无频闪、显色指数Ra≥90的LED灯具，避免长时间阅读伤眼。书桌上方灯具需防眩光设计，避免直射眼睛。',
  ],
];
const control = (raw: string, feedback: string): ModelMessage[] => [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: feedback }] }];

test('retained1364/1367 material drafts receive numeric-only diagnostics with explicit per-segment citation choices', () => {
  for (const text of planDrafts) {
    const raw = JSON.stringify({ kind: 'synthesis', segments: [
      { basis: 'evidence', text, citations: [0, 1, 2, 3].map(cite) },
      { basis: 'uncertainty', text: '这次可用资料不足以核实现场尺寸。', citations: [cite(5)] },
    ] }), before = JSON.stringify(sources);
    assert.throws(() => parseSynthesis(raw, sources), /unsupported_model_commitment/);
    const issue = synthesisRepairFeedback(raw, sources); assert.ok(issue);
    assert.match(issue.feedback, /segments\[0\]\.text/);
    assert.match(issue.feedback, new RegExp(cite(4).citationId)); assert.match(issue.feedback, new RegExp(cite(5).citationId));
    const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw),
      edits: [{ segment: 0, text: '书房需要收纳、客厅保留阅读角，书桌当前意向为靠内墙。', removeCitationIds: [cite(0).citationId] }],
      append: [
        { basis: 'evidence', text: '当前全屋预算意向18万元。', citations: [cite(4)] },
        { basis: 'evidence', text: '资料包含正式v4户型，原说明为非实机量测。', citations: [cite(5)] },
      ] }), control(raw, issue.feedback), sources, 1);
    const accepted = parseSynthesis(repaired, sources); assert.equal(accepted.kind, 'synthesis');
    assert.ok(accepted.segments.every(s => s.citations.length <= 4)); assert.equal(JSON.stringify(sources), before);
    const unchanged = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [{ segment: 0, basis: 'uncertainty' }] }), control(raw, issue.feedback), sources, 1);
    assert.throws(() => parseSynthesis(unchanged, sources), /unsupported_model_commitment/);
  }
});

test('retained1365/1368 unsupported general-advice quantities can be removed in the same synthesis repair', () => {
  for (const texts of adviceDrafts) {
    const raw = JSON.stringify({ kind: 'synthesis', segments: texts.map(text => ({ basis: 'advice', text, citations: [] })) });
    assert.throws(() => parseSynthesis(raw, sources), /unsupported_model_commitment/);
    const issue = synthesisRepairFeedback(raw, sources); assert.ok(issue); assert.match(issue.feedback, /removeUnsupportedNumbers/);
    const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [
      { segment: 0, text: '可用均匀的基础照明搭配可调台灯，选择防眩光灯具，阅读时避开直射。' },
      { segment: 1, remove: true },
    ] }), control(raw, issue.feedback), sources, 1);
    assert.equal(parseSynthesis(repaired, sources).kind, 'synthesis');
    assert.throws(() => parseSynthesis(raw, sources), /unsupported_model_commitment/);
  }
});

test('material numeric diagnostics keep unknown citations, positive commitments and unsupported site facts closed', () => {
  for (const text of ['现场已经验收。', '保证全屋预算18万元以内。', '现场宽度800毫米。']) {
    const raw = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text, citations: [cite(4)] }] });
    assert.throws(() => parseSynthesis(raw, sources), /unsupported_model_commitment/);
    assert.throws(() => synthesisRepairFeedback(raw, sources), /unsupported_model_commitment/);
  }
  const unknown = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'advice', text: '灯具选择3000K。', citations: [{ citationId: 'unknown' }] }] });
  assert.throws(() => synthesisRepairFeedback(unknown, sources), /invalid_model_citation/);
  const malformed = JSON.stringify({ kind: 'synthesis', extra: true, segments: [{ basis: 'advice', text: '灯具选择3000K。', citations: [] }] });
  assert.throws(() => synthesisRepairFeedback(malformed, sources), /invalid_model_answer/);
});
