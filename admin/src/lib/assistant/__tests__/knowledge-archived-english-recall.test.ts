import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../../../scripts/fixtures/assistant-knowledge-archived-english-recall.json';
import { selectContextCandidates } from '../knowledge/context-selection';
import { filePassages } from '../knowledge/source-file';
import { fingerprint } from '../contracts';
import type { ParsedFile, SourceFile } from '../contracts/source-file';

test('archived Chinese-question English-PDF omission reaches current selection without new embeddings', () => {
  const snapshot = structuredClone(fixture);
  const originals = new Map(Object.values(fixture.documents).map(doc => {
    const file: SourceFile = { version: 1, assetId: 'archive-only', hash: doc.sourceHash, name: `synthetic.${doc.format}`,
      format: doc.format as 'docx' | 'pdf', parsed: doc.parsed as ParsedFile, review: null };
    const passages = new Map(filePassages(file).map(p => [fingerprint(p.text), p.text]));
    return [doc.documentId, { doc, passages }] as const;
  }));
  for (const [i, c] of fixture.candidates.entries()) {
    assert.equal(c.fusionRank, i + 1);
    const original = originals.get(c.documentId)!;
    assert.equal(c.ref.version, original.doc.versionId);
    assert.ok(original.passages.has(c.hash), `Archived chunk ${c.ref.id} must match its original passage hash`);
  }
  assert.deepEqual(fixture.observedSelection.map(s => s.ref.id), fixture.candidates.filter(c => c.disposition === 'selected').map(c => c.ref.id));
  assert.ok(fixture.observedSelection.every(s => s.ref.version === fixture.documents.docx.versionId));
  const required = fixture.candidates.find(c => c.ref.id === fixture.required.chunkId)!;
  assert.equal(required.semanticRank, 1); assert.equal(required.fusionRank, 6); assert.equal(required.disposition, 'ranked_out');
  assert.ok(required.similarity >= fixture.configuration.minSimilarity);
  assert.equal(originals.get(required.documentId)!.passages.get(required.hash), fixture.required.text);

  // Freeze the measured eligibility/order. This does not rerun SQL, authorization or query embedding.
  const eligible = fixture.candidates.filter(c => c.similarity >= fixture.configuration.minSimilarity)
    .map(c => ({ ...c, id: c.ref.id, document_id: c.documentId }));
  const selected = selectContextCandidates(eligible, new Map(), fixture.configuration.limit);
  assert.equal(selected.length, 5);
  assert.ok(selected.some(c => c.id === required.ref.id && c.ref.version === fixture.required.versionId));
  assert.ok(selected.every(c => eligible.includes(c)), 'Selected identities, hashes and captured metadata stay original');
  assert.deepEqual(fixture, snapshot, 'Historical failure evidence is not rewritten as a current success');
});
