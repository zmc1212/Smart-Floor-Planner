import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentRuntimeBindings, nativeAgentRuntimeBinding, parseAgentRuntimeBinding, parseAgentRuntimeBindings } from '../fastgpt/agent-v2/config';
import { parseSuggestionQuestions, resolveSuggestions, resumeSuggestionGeneration, storedSuggestionQuestions, suggestionPrompt } from '../fastgpt/agent-v2/suggestions';

const base = {
  protocol: 'fastgpt-agent-v2-v1' as const, enterpriseId: '1454', runtime: 'langgraph-v1' as const,
};

test('presets are validated as part of the native deployment binding', () => {
  const parsed = parseAgentRuntimeBinding({ ...base, presets: ['旧房改造从哪里开始？', '预算怎么安排？'] });
  assert.deepEqual(parsed.presets, ['旧房改造从哪里开始？', '预算怎么安排？']);
  for (const bad of [
    { presets: [] },
    { presets: ['重复的问题', '重复的问题'] },
    { presets: ['长'.repeat(41)] },
    { runtime: 'fastgpt-agent-v2' },
    { runtime: undefined },
  ]) assert.throws(() => parseAgentRuntimeBinding({ ...base, ...bad }), /context_changed/);
});

test('generated follow-ups strip vendor formatting and require three usable questions', () => {
  assert.deepEqual(parseSuggestionQuestions('1. 水路开工前要做什么？\n- 防水闭水多久检查？\n（3）地砖怎么排版？\n4、门窗怎么保护？'),
    ['水路开工前要做什么？', '防水闭水多久检查？', '地砖怎么排版？', '门窗怎么保护？']);
  assert.deepEqual(parseSuggestionQuestions('1. 水路开工前要做什么？\n2. 防水闭水多久检查？'), []);
  assert.deepEqual(parseSuggestionQuestions('“水路开工前要做什么？”\n“水路开工前要做什么？”\n防水闭水多久检查？\n问题3：地砖怎么排版？\n地砖怎么排版？'),
    ['水路开工前要做什么？', '防水闭水多久检查？', '地砖怎么排版？']);
  assert.deepEqual(parseSuggestionQuestions('长'.repeat(41) + '？\n防水闭水多久检查？\n地砖怎么排版？'), []);
});

test('a failed, empty or malformed generation falls back to the configured presets', () => {
  const presets = ['旧房改造从哪里开始？', '预算怎么安排？', '风格怎么选？'];
  assert.deepEqual(resolveSuggestions('水路开工前要做什么？\n防水闭水多久检查？\n地砖怎么排版？', presets),
    { questions: ['水路开工前要做什么？', '防水闭水多久检查？', '地砖怎么排版？'], source: 'model' });
  assert.deepEqual(resolveSuggestions(null, presets), { questions: presets, source: 'presets' });
  assert.deepEqual(resolveSuggestions('只有一条？', presets), { questions: presets, source: 'presets' });
});

test('stored questions are revalidated before readback and bounded to four', () => {
  assert.deepEqual(storedSuggestionQuestions(['一条？', ' 两条？', '三条？', '四条？', '五条？', '六条？']),
    ['一条？', '三条？', '四条？', '五条？']);
  assert.deepEqual(storedSuggestionQuestions(['长'.repeat(41), 3, null]), []);
  assert.deepEqual(storedSuggestionQuestions('not-an-array'), []);
});

test('a resumed suggestion dispatch reuses its persisted output and never replays unknown calls', () => {
  assert.deepEqual(resumeSuggestionGeneration(undefined), { action: 'dispatch' });
  assert.deepEqual(resumeSuggestionGeneration({ status: 'succeeded', private_checkpoint: { text: '水路先做什么？\n防水怎么验收？\n地砖怎么排版？' } }),
    { action: 'reuse', text: '水路先做什么？\n防水怎么验收？\n地砖怎么排版？' });
  // Dispatched without a persisted outcome: the presets stand, the provider is
  // not called a second time and the unknown outcome stays visible.
  assert.deepEqual(resumeSuggestionGeneration({ status: 'running' }), { action: 'skip', unknown: true });
  assert.deepEqual(resumeSuggestionGeneration({ status: 'failed', private_checkpoint: null }), { action: 'skip', unknown: false });
  assert.deepEqual(resumeSuggestionGeneration({ status: 'failed',
    input_summary: { code: 'provider_outcome_unknown' } }), { action: 'skip', unknown: true });
  assert.deepEqual(resumeSuggestionGeneration({ status: 'failed', input_summary: { code: 'assistant_disabled' } }),
    { action: 'skip', unknown: false });
  assert.deepEqual(resumeSuggestionGeneration({ status: 'succeeded', private_checkpoint: { text: 3 } }), { action: 'skip', unknown: false });
});

test('the generation prompt carries only the bounded answer and removes citation markers', () => {
  const prompt = suggestionPrompt('水路先做打压试验[K11](CITE)。'.repeat(400));
  assert.match(prompt, /^下面是本轮给客户的回答/);
  assert.equal(prompt.includes('[K11](CITE)'), false);
  assert.equal(Array.from(prompt).length < 4300, true);
});

test('several enterprises share one file, bind independently and fail closed on legacy runtime values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-binding-enterprises-'));
  const file = path.join(directory, 'runtime.json');
  const previous = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  const second = { ...base, enterpriseId: '2884', presets: ['企业二的问题？'] };
  try {
    process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = file;
    fs.writeFileSync(file, JSON.stringify({ agentV2: [base, second] }));
    assert.deepEqual(agentRuntimeBindings().map(item => item.configuration.enterpriseId), ['1454', '2884']);
    const first = nativeAgentRuntimeBinding('1454'), other = nativeAgentRuntimeBinding('2884');
    assert.ok(first && other);
    assert.notEqual(first.binding, other.binding);
    assert.equal(nativeAgentRuntimeBinding('9999'), undefined);
    // A historical `fastgpt-agent-v2` entry no longer selects a runtime.
    fs.writeFileSync(file, JSON.stringify({ agentV2: [base, { ...second, runtime: 'fastgpt-agent-v2' }] }));
    assert.throws(() => nativeAgentRuntimeBinding('1454'), /context_changed/);
    assert.throws(() => parseAgentRuntimeBindings([base, { ...second, enterpriseId: '1454' }]), /context_changed/);
  } finally {
    if (previous === undefined) delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
    else process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
