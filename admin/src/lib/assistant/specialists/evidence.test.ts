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

test('an enterprise citation must match the active epoch, original version and lookup scope', () => {
  const candidate = { ...input, answer: { kind: 'synthesis' as const, segments: [
    { basis: 'evidence' as const, text: '由团队安排检查', citations: [{ sourceId: 'K3', quote: knowledge.text }] },
  ] }, enterprise: { status: 'sources_found' as const, epoch: 2, sources: [knowledge] } };
  assert.equal(specialistChecks(candidate).hasEnterprise, true);
  assert.equal(specialistChecks({ ...candidate, knowledgeEpoch: 3 }).hasEnterprise, false);
  const otherProject = { ...knowledge, knowledge: { ...knowledge.knowledge!, scope: 'project' as const, projectId: '2' } };
  assert.equal(specialistChecks({ ...candidate, sources: [{ ...sources[0], evidence: otherProject }] }).hasEnterprise, false);
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
