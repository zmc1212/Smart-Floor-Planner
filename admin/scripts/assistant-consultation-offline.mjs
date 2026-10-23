// Offline only: consumes saved attempts, never imports a dispatcher or opens a service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseAgentChat } from '../src/lib/ai/providers/agent-chat.ts';
import { assertToolPairs } from '../src/lib/assistant/agent/context-budget.ts';
import { consultationAcceptanceProfile } from '../src/lib/assistant/contracts/consultation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = path.join(root, 'tmp/xiaok-intelligent-consult');
const output = path.join(root, 'tmp/xiaok-consultation-r0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = [];
function read(name) {
  const bytes = fs.readFileSync(path.join(input, name));
  inputs.push({ path: 'tmp/xiaok-intelligent-consult/' + name, sha256: hash(bytes) });
  return JSON.parse(bytes.toString('utf8'));
}
function messages(raw) {
  return raw.map(message => message.role === 'tool'
    ? { role: 'tool', callId: message.tool_call_id, content: message.content }
    : message.role === 'assistant'
      ? { role: 'assistant', content: message.content || '', toolCalls: message.tool_calls?.map(call => ({
        id: call.id, name: call.function.name, arguments: call.function.arguments })) }
      : { role: message.role, content: typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }] : message.content });
}
const batches = ['openwebui-mature-live-04-ready.json', 'openwebui-mature-transport-live-04.json'].map(read);
const wires = [], catalogs = [], images = [];
for (const [batch, saved] of batches.entries()) for (const run of saved.runs) {
  for (const [ordinal, wire] of run.providerWire.entries()) {
    assert.equal(wire.input.model, consultationAcceptanceProfile.model);
    assert.equal(wire.input.enable_thinking, false);
    assert.equal(wire.input.max_tokens, consultationAcceptanceProfile.maxOutputTokens);
    assertToolPairs(messages(wire.input.messages));
    const parsed = parseAgentChat(wire.response, wire.providerRequestId);
    assert.ok(!wire.response.choices[0].message.reasoning_content);
    assert.ok(parsed.usage, 'Missing usage is unknown, never zero');
    const raw = wire.response.choices[0].message;
    assert.equal(parsed.text, raw.content || '');
    assert.deepEqual(parsed.toolCalls, (raw.tool_calls || []).map(call => ({ id: call.id,
      name: call.function.name, arguments: call.function.arguments })));
    wires.push({ batch, runId: run.accountingRunId, ordinal, inputHash: hash(JSON.stringify(wire.input)),
      responseHash: hash(JSON.stringify(wire.response)), usage: parsed.usage, pairsPassed: true, parsedPassed: true });
    for (const message of wire.input.messages) for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type !== 'image_url') continue;
      const match = /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(part.image_url.url);
      assert.ok(match, 'Original image must be embedded, not a client-controlled remote URL');
      const sha256 = hash(Buffer.from(match[1], 'base64'));
      assert.ok(['qwen37-drawing-v1.png', 'qwen37-drawing-v2.png'].some(name => hash(fs.readFileSync(path.join(input, name))) === sha256));
      images.push({ runId: run.accountingRunId, ordinal, sha256 });
    }
  }
  const sources = run.answer.sources || [];
  const sourceCount = sources.reduce((count, source) => count + (source.document?.length || 0), 0);
  const cited = [...new Set([...run.answer.content.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])))];
  const missing = cited.filter(index => index < 1 || index > sourceCount);
  catalogs.push({ batch, runId: run.accountingRunId, kind: run.kind, trial: run.trial, turn: run.turn,
    sourceCount, cited, missing, answerHash: hash(run.answer.content), persistedReentry: run.savedReentry });
}
assert.equal(wires.length, 51);
assert.equal(catalogs.length, 20);
assert.ok(catalogs.every(catalog => catalog.persistedReentry));
const broken = catalogs.filter(catalog => ['8963', '8965'].includes(catalog.runId));
assert.equal(broken.length, 2);
assert.ok(broken.every(catalog => catalog.missing.length > 0), 'Preserve the original catalog failures');
const ocr = read('openwebui-continuity-ocr-02.json');
const drawings = ocr.map(item => {
  const bytes = fs.readFileSync(path.join(input, item.file)), result = item.result;
  assert.equal(hash(bytes), result.image_sha256);
  assert.deepEqual(result.image_size, [1440, 1040]);
  const dimensions = result.labels.filter(label => /\b(?:5400|4200)\s*mm\b/.test(label.text));
  assert.equal(dimensions.length, 2);
  for (const label of dimensions) assert.ok(label.box.every(([x, y]) => x >= 0 && y >= 0 && x <= 1440 && y <= 1040));
  inputs.push({ path: 'tmp/xiaok-intelligent-consult/' + item.file, sha256: hash(bytes) });
  return { path: item.file, sha256: hash(bytes), size: result.image_size,
    dimensions: dimensions.map(label => ({ text: label.text, box: label.box, ocrConfidence: label.confidence,
      dimensionType: 'unspecified', typeEvidence: null })), semanticsPassed: false };
});
const acquisition = read('openwebui-mature-acquisition-02.json');
assert.equal(acquisition.modelCalls, 0);
assert.equal(acquisition.notProvidedToModel, true);
const report = {
  protocol: 'consultation-r0-offline-v1', created: new Date().toISOString(), newModelCalls: 0,
  profile: consultationAcceptanceProfile, inputs, wires, catalogs, images, drawings,
  sourceNavigation: { modelCalls: acquisition.modelCalls, independentAcquisitionPassed: acquisition.passed,
    steps: acquisition.steps.map(step => ({ url: step.url, status: step.status,
      links: step.result?.links?.length || 0, textHash: step.result?.text ? hash(step.result.text) : null })) },
  attribution: {
    acquisition: 'Agent/hosted discovery; independent original read does not prove autonomous discovery',
    catalog: 'stock extension source projection/lifecycle; no demonstrated KnowledgeRetriever defect',
    drawing: 'raw provider consumption/semantic error; complete image bytes do not prove correct understanding',
    product: 'legacy 2048 output, current-run catalogs and provider-name perception are separate untested boundaries',
  },
  originalFailuresPreserved: true, businessAcceptancePassed: false,
};
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'offline.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: path.relative(root, output), newModelCalls: 0, wires: wires.length,
  catalogs: catalogs.length, brokenCatalogs: broken.map(item => ({ runId: item.runId, missing: item.missing })),
  imageInputs: images.length, drawingHashes: drawings.map(item => item.sha256), businessAcceptancePassed: false }));
