import assert from 'node:assert/strict';
import test from 'node:test';
import type { Evidence } from '../contracts';
import type { SynthesisAnswer, SynthesisSource } from '../agent/synthesis';
import { specialistChecks } from './evidence';

const knowledge: Evidence = {
  ref: { type: 'knowledge_chunk', id: '3', version: '7' }, hash: 'company-hash', text: '项目团队安排后续检查。',
  knowledge: { enterpriseName: '微云', documentId: '4', title: '工艺', versionId: '7', versionNumber: 1,
    scope: 'enterprise', projectId: null, category: '施工工艺', sourceType: 'file', effectiveFrom: '2026-11-13', effectiveTo: null, published: true },
};
const web: Evidence = {
  ref: { type: 'web_page', id: '5:1298:0', version: 'page-hash' }, hash: 'page-hash', text: '引用的已核原文。',
  web: { url: 'https://example.org/standard.pdf', title: '标准', hash: 'page-hash', retrievedAt: '2026-11-13',
    parser: 'crawl4ai-static-0.9.2+pypdf-6.21.2-v1', textBytes: 36,
    standard: { id: 'GB55030-2022', name: '防水', kind: 'standard_text', level: 'national', status: 'unknown' },
    document: { hash: 'pdf-hash', page: 31, pages: 40, bytes: 100, mediaType: 'application/pdf', reviewedTextHash: 'reviewed-hash' } },
};
const sources: SynthesisSource[] = [
  { kind: 'knowledge', sourceId: 'K3', title: '工艺', text: knowledge.text, evidence: knowledge },
  { kind: 'web', sourceId: 'W5', title: '标准', text: web.text, evidence: web, web: web.web },
];
const answer: SynthesisAnswer = { kind: 'synthesis', segments: [
  { basis: 'evidence', text: '可核对公开原文', citations: [{ sourceId: 'W5', quote: web.text }] },
  { basis: 'advice', text: '一般建议', citations: [] },
] };
const input = {
  answer, sources, project: { id: '11', roomId: '15', stage: 'waterproof', revision: 1, records: [] },
  enterprise: { status: 'unavailable' as const, epoch: 2 },
  publicStandard: { status: 'ready', editionStatus: 'current', standardId: 'GB55030-2022', sources: [{ hash: 'pdf-hash', page: 31 }] },
  knowledgeEpoch: 2,
};

test('a cited, current public page independently supports the checklist while an enterprise outage stays visible', () => {
  const result = specialistChecks(input);
  assert.equal(result.hasEnterprise, false);
  assert.equal(result.hasPublic, true);
  assert.equal(result.evidenceRefs[0].page, 31);
  assert.equal(result.evidenceRefs[0].standardId, 'GB55030-2022');
  assert.ok(result.unresolvedItems.includes('企业知识服务暂不可用'));
  assert.deepEqual(result.requestedChecks[1].basis, ['general_advice']);
  assert.equal(specialistChecks({ ...input, answer: { ...answer, segments: [answer.segments[1]] } }).hasPublic, false);
  assert.equal(specialistChecks({ ...input, publicStandard: { ...input.publicStandard, editionStatus: 'withdrawn' } }).hasPublic, false);
  assert.equal(specialistChecks({ ...input, sources: [sources[0]] }).hasPublic, false);
});

test('a version-bound checklist can cite the exact reviewed original with unknown edition status', () => {
  const publicStandard = { ...input.publicStandard, editionStatus: 'unknown' };
  const binding = { agentId: 'waterproof-specialist', agentVersion: 2, workflowRunId: 'specialist:42',
    workflowRevision: 4, workflowDigest: 'a'.repeat(64) };
  assert.equal(specialistChecks({ ...input, publicStandard }).hasPublic, false);
  const result = specialistChecks({ ...input, publicStandard, binding });
  assert.equal(result.hasPublic, true);
  assert.ok(result.unresolvedItems.includes('本次已核对公开规范原页，现行状态待核实'));
  assert.deepEqual(result.requestedChecks.map(check => [check.workflowRevision, check.workflowDigest, check.publicEditionStatus]),
    [[4, binding.workflowDigest, 'unknown'], [4, binding.workflowDigest, undefined]]);
  assert.equal(specialistChecks({ ...input, publicStandard: { ...publicStandard, sources: [{ hash: 'changed', page: 31 }] }, binding }).hasPublic, false);
  assert.equal(specialistChecks({ ...input, publicStandard: { ...publicStandard, editionStatus: 'withdrawn' }, binding }).hasPublic, false);
});

test('an enterprise citation must match the active epoch, original version and lookup scope', () => {
  const candidate = { ...input, answer: { kind: 'synthesis' as const, segments: [
    { basis: 'evidence' as const, text: '由团队安排检查', citations: [{ sourceId: 'K3', quote: knowledge.text }] },
  ] }, enterprise: { status: 'sources_found' as const, epoch: 2, sources: [knowledge] } };
  assert.equal(specialistChecks(candidate).hasEnterprise, true);
  assert.equal(specialistChecks({ ...candidate, knowledgeEpoch: 3 }).hasEnterprise, false);
  const otherProject = { ...knowledge, knowledge: { ...knowledge.knowledge!, scope: 'project' as const, projectId: '2' } };
  assert.equal(specialistChecks({ ...candidate, sources: [{ ...sources[0], evidence: otherProject }] }).hasEnterprise, false);
});

test('every check binds project, room, stage, agent, run, evidence versions and an explicit status', () => {
  const result = specialistChecks({ ...input,
    binding: { agentId: 'waterproof-specialist', agentVersion: 3, workflowRunId: 'specialist:42' } });
  const [publicCheck, adviceCheck] = result.requestedChecks;
  assert.match(publicCheck.checkId!, /^check_/);
  assert.equal(publicCheck.projectId, '11');
  assert.equal(publicCheck.roomId, '15');
  assert.equal(publicCheck.stage, 'waterproof');
  assert.equal(publicCheck.agentId, 'waterproof-specialist');
  assert.equal(publicCheck.agentVersion, 3);
  assert.equal(publicCheck.workflowRunId, 'specialist:42');
  assert.deepEqual(publicCheck.evidenceVersions, ['page-hash']);
  assert.equal(publicCheck.sourceType, 'public_standard');
  assert.equal(publicCheck.applicability, 'applicable');
  assert.equal(publicCheck.checkStatus, 'public_explicit');
  assert.equal(publicCheck.needsHumanReview, false);
  assert.match(publicCheck.currentProjectState!, /防水|waterproof/);
  assert.equal(adviceCheck.checkStatus, 'general_advice');
  assert.equal(adviceCheck.sourceType, 'general_advice');
  assert.deepEqual(adviceCheck.evidenceVersions, []);
});

test('missing evidence, not applicable and acceptance text stay reviewable instead of becoming completed checks', () => {
  const material = { ref: { type: 'site_record', id: '91', version: '2' }, hash: 'site-hash',
    projectId: '11', roomId: '15' } as NonNullable<SynthesisSource['material']>;
  const source = { kind: 'project' as const, sourceId: 'P1', title: '现场记录', text: '管根已清理', material };
  const projectInput = { ...input, answer: { kind: 'synthesis' as const, segments: [
    { basis: 'evidence' as const, text: '管根已清理', citations: [{ sourceId: 'P1', quote: source.text }] },
  ] }, sources: [source], project: { ...input.project, records: [{ id: '91', version: 2, hash: 'site-hash' }] } };
  const moved = specialistChecks({ ...projectInput, project: { ...projectInput.project, roomId: '16' } });
  assert.equal(moved.requestedChecks[0].checkStatus, 'evidence_missing');
  assert.equal(moved.requestedChecks[0].applicability, 'unknown');
  assert.equal(moved.requestedChecks[0].needsHumanReview, true);
  const acceptance = specialistChecks({ ...input, answer: { kind: 'synthesis',
    segments: [{ basis: 'advice', text: '你家基层已经验收合格。', citations: [] }] } });
  assert.equal(acceptance.requestedChecks[0].checkStatus, 'pending_review');
  assert.equal(acceptance.requestedChecks[0].needsHumanReview, true);
});

test('the ten waterproof dimensions are classified without inventing a status or reason', () => {
  const texts = ['开工前核对基层空鼓和含水率', '管根和地漏周边要单独密封', '阴阳角要做圆弧处理', '预埋套管和止水节位置要核对',
    '按企业工艺做法执行', '防水材料合格证和施工记录要留存', '防水层涂刷要连续', '闭水试验和验收依据要核对',
    '防水层完成后做保护层', '贴砖前要满足下一道工序条件'];
  const categories = texts.map(text => specialistChecks({ ...input, answer: { kind: 'synthesis',
    segments: [{ basis: 'advice', text, citations: [] }] } }).requestedChecks[0].category);
  assert.deepEqual(categories, ['base_course', 'pipe_root', 'corner', 'embed', 'enterprise_process',
    'material_record', 'waterproof_layer', 'test_acceptance', 'protection', 'next_process']);
  assert.equal(specialistChecks({ ...input, answer: { kind: 'synthesis',
    segments: [{ basis: 'advice', text: '其他现场沟通事项', citations: [] }] } }).requestedChecks[0].category, 'other');
});

test('a project check needs the selected room, publication revision and original record fingerprint', () => {
  const material = { ref: { type: 'site_record', id: '91', version: '2' }, hash: 'site-hash',
    projectId: '11', roomId: '15' } as NonNullable<SynthesisSource['material']>;
  const source = { kind: 'project' as const, sourceId: 'P1', title: '现场记录', text: '管根已清理', material };
  const current = { ...input, answer: { kind: 'synthesis' as const, segments: [
    { basis: 'evidence' as const, text: '管根已清理', citations: [{ sourceId: 'P1', quote: source.text }] },
  ] }, sources: [source], project: { ...input.project, records: [{ id: '91', version: 2, hash: 'site-hash' }] } };
  assert.deepEqual(specialistChecks(current).requestedChecks[0].basis, ['project_fact']);
  const moved = { ...current.project, roomId: '16' };
  assert.deepEqual(specialistChecks({ ...current, project: moved }).requestedChecks[0].basis, ['unverified']);
  assert.deepEqual(specialistChecks({ ...current, project: { ...current.project,
    records: [{ ...current.project.records[0], version: 3 }] } }).requestedChecks[0].basis, ['unverified']);
});
