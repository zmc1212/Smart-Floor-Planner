import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../contracts';
import { assertModelTurnBand, dialogueWebResearch, maxModelTurns, modelStepBase, modelStepStride,
  resolveWebCandidate, validWebSnapshot, webCandidateInstructions, webCitations, webCitedInstructions,
  webReceipt, webStepBase, webStepCeiling, webStepSeq, type WebToolInput, type WebToolRuntime } from '../agent/dialogue-web-tools';
import { parsePublicRead } from '../agent/public-research';
import { webEvidence, webSynthesisSources } from '../agent/web-evidence';
import type { WebSearchSnapshot } from '../agent/web';

/** Pure unit coverage for the shared web tools. No DB: only the exported
 * step-band guards, candidate resolution, snapshot validation and receipt
 * shapes are exercised here; the factories need a live run. */

const retrievedAt = '2026-01-01T00:00:00.000Z';
const webPage = (index: number) => {
  const url = `https://example.com/doc/${index}`, title = `安装手册${index}`, text = '这是实际读取的公开网页原文，用于单元测试断言。'.repeat(3);
  return { url, title, text, retrievedAt, parser: 'public-html-text-v1' as const,
    textBytes: Buffer.byteLength(text), hash: fingerprint({ url, title, text, retrievedAt }) };
};
const snapshotAt = (stepSeq: number, candidateIds: string[], pages: ReturnType<typeof webPage>[] = []):
  { stepSeq: number; snapshot: WebSearchSnapshot } => ({
  stepSeq,
  snapshot: { version: 1, provider: 'test', query: { query: '地暖 安装手册', domains: [] },
    status: pages.length ? 'ready' : 'empty', pages, failures: [], retrievedAt,
    candidates: candidateIds.map((id, index) => ({ id, url: `https://example.com/c/${index}`, title: '候选', parent: null, depth: 0 })) },
});

test('factory inputs pass the agreed parameter object to the strict read parser', () => {
  // The shared factory strips the discriminating `name` before parsing: the
  // strict parser accepts exactly one `candidateId` key. Passing the full
  // WebToolInput would fail closed on every surface, so this contract is
  // pinned here (the live W3 recovery scenario drives the real dispatcher).
  const read: WebToolInput = { name: 'read_web', candidateId: 'P5:1200:0' };
  assert.equal(parsePublicRead({ candidateId: read.candidateId }).candidateId, 'P5:1200:0');
  assert.throws(() => parsePublicRead(read), (error: { code?: string }) => error.code === 'invalid_web_candidate');
  assert.throws(() => parsePublicRead({ candidateId: 'https://example.com' }),
    (error: { code?: string }) => error.code === 'invalid_web_candidate');
});

test('web steps occupy 1200+sequence and stop at the 12xx ceiling', () => {
  assert.equal(webStepBase, 1200);
  assert.equal(webStepCeiling, 1299);
  assert.equal(webStepSeq(0), 1200);
  assert.equal(webStepSeq(99), 1299);
  assert.throws(() => webStepSeq(100), /web_research_limit/);
  assert.throws(() => webStepSeq(-1), /web_research_limit/);
  assert.throws(() => webStepSeq(Number.NaN), /web_research_limit/);
});

test('model turns stay below the web band: 1100+turn*10 with ten slots per turn', () => {
  assert.equal(modelStepBase, 1100);
  assert.equal(modelStepStride, 10);
  assert.equal(maxModelTurns, 9);
  // Even the last tool slot of the last allowed turn ends at 1199 < 1200.
  assert.equal(modelStepBase + maxModelTurns * modelStepStride + modelStepStride - 1, webStepBase - 1);
  for (let turn = 0; turn <= maxModelTurns; turn++) assert.equal(assertModelTurnBand(turn), 1100 + turn * 10);
  assert.throws(() => assertModelTurnBand(maxModelTurns + 1), /agent_turn_limit/);
  assert.throws(() => assertModelTurnBand(-1), /agent_turn_limit/);
  assert.throws(() => assertModelTurnBand(Number.NaN), /agent_turn_limit/);
});

test('read_web resolves a candidate only inside this run\'s persisted snapshots', () => {
  const snapshots = [snapshotAt(1201, ['P5:1201:0']), snapshotAt(1200, ['P5:1200:0', 'P5:1200:1'])];
  const resolved = resolveWebCandidate('P5:1200:1', snapshots);
  assert.ok(resolved);
  assert.equal(resolved.stepSeq, 1200);
  assert.equal(resolved.selected.url, 'https://example.com/c/1');
  assert.equal(resolved.origin, snapshots[1].snapshot);
  assert.equal(resolveWebCandidate('P5:1200:2', snapshots), null);
  assert.equal(resolveWebCandidate('P6:1200:0', snapshots), null);
  assert.equal(resolveWebCandidate('P5:1200:0', []), null);
});

test('snapshots from another query or version are rejected before becoming evidence', () => {
  const { snapshot } = snapshotAt(1200, []);
  assert.equal(validWebSnapshot(snapshot, { query: '地暖 安装手册', domains: [] }), true);
  assert.equal(validWebSnapshot({ ...snapshot, version: 2 } as unknown as WebSearchSnapshot, { query: '地暖 安装手册', domains: [] }), false);
  assert.equal(validWebSnapshot(snapshot, { query: '别的产品', domains: [] }), false);
});

test('receipts carry documents, registered cites and the read instructions', () => {
  const { snapshot } = snapshotAt(1200, ['P5:1200:0'], [webPage(0)]);
  const evidence = webEvidence(snapshot, '5', 1200);
  const sources = webSynthesisSources(evidence);
  const catalog = new Map(), cites = webCitations(catalog, sources);
  assert.ok(cites.length >= 1);
  const receipt = webReceipt(snapshot, sources, cites);
  assert.equal(receipt.status, 'ready');
  assert.equal(receipt.instructions, webCitedInstructions);
  assert.deepEqual(receipt.documents, sources.map(s => ({ title: s.title, url: s.web!.url, text: s.text })));
  assert.deepEqual(receipt.failures, []);
  assert.deepEqual(receipt.candidates, snapshot.candidates);
  assert.ok(receipt.prompt);
  assert.deepEqual(receipt.cites, cites);
  assert.equal(catalog.get(cites[0].id)?.sourceId, 'W5:1200:0');
  assert.equal(catalog.get(cites[0].id)?.evidence, evidence[0]);
});

test('a candidate-only result keeps the candidate instructions and no cites', () => {
  const { snapshot } = snapshotAt(1200, ['P5:1200:0']);
  const receipt = webReceipt(snapshot, [], []);
  assert.equal(receipt.status, 'empty');
  assert.equal(receipt.instructions, webCandidateInstructions);
  assert.deepEqual(receipt.documents, []);
  assert.equal(receipt.prompt, undefined);
  assert.equal(receipt.cites, undefined);
});

test('importing the module and creating the dispatcher touches no database', () => {
  const runtime = { lease: { enterpriseId: '1454', jobId: '1', runId: '5', token: 't',
    actor: { enterpriseId: '1454', principal: { kind: 'user' as const, userId: '7' }, contextVersion: 1, capabilities: [] } },
    protocol: 'test', authorize: async () => { throw new Error('authorize must not run at creation'); },
    context: { version: 1 as const, knowledge: [], snapshots: [], sources: [] },
    catalog: new Map(), messages: [], markWebRetrieved: () => {} };
  assert.equal(typeof dialogueWebResearch(runtime as unknown as WebToolRuntime), 'function');
});
