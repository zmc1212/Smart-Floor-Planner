import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fastGPTAgentV2Presentation, parseAgentV2Configuration } from '../fastgpt/agent-v2/config';
import { parseSuggestionQuestions, resolveSuggestions, storedSuggestionQuestions, suggestionPrompt } from '../fastgpt/agent-v2/suggestions';

const base = {
  protocol: 'fastgpt-agent-v2-v1' as const, enterpriseId: '1454', appId: '6af16527093915ea6cf38496',
  model: 'deepseek-v4.1-flash-1017', bridgeKey: 'b'.repeat(64), runtime: 'fastgpt-agent-v2' as const,
};

test('welcome, presets and the suggestion app are validated as part of the private binding', () => {
  const parsed = parseAgentV2Configuration({ ...base, welcome: '想先聊点什么？',
    presets: ['旧房改造从哪里开始？', '预算怎么安排？'], suggestionAppId: '6af16527093915ea6cf38497' });
  assert.deepEqual(parsed.presets, ['旧房改造从哪里开始？', '预算怎么安排？']);
  for (const bad of [
    { welcome: ' 想先聊点什么？' },
    { welcome: '' },
    { presets: [] },
    { presets: ['重复的问题', '重复的问题'] },
    { presets: ['长'.repeat(41)] },
    { suggestionAppId: 'not-an-app-id' },
  ]) assert.throws(() => parseAgentV2Configuration({ ...base, ...bad }), /context_changed/);
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

test('the generation prompt carries only the bounded answer and removes citation markers', () => {
  const prompt = suggestionPrompt('水路先做打压试验[K11](CITE)。'.repeat(400));
  assert.match(prompt, /^下面是本轮给客户的回答/);
  assert.equal(prompt.includes('[K11](CITE)'), false);
  assert.equal(Array.from(prompt).length < 4300, true);
});

test('bootstrap presentation comes from the enabled private runtime and stays additive', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-v2-presentation-'));
  const file = path.join(directory, 'runtime.json');
  const previous = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  try {
    fs.writeFileSync(file, JSON.stringify({ agentV2: { ...base, welcome: '想先聊点什么？', presets: ['旧房改造从哪里开始？'] } }));
    process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = file;
    assert.deepEqual(fastGPTAgentV2Presentation('1454'), { welcome: '想先聊点什么？', presets: ['旧房改造从哪里开始？'] });
    assert.equal(fastGPTAgentV2Presentation('2884'), undefined);
    fs.writeFileSync(file, JSON.stringify({ agentV2: { ...base, runtime: 'langgraph-v1', welcome: '想先聊点什么？' } }));
    assert.equal(fastGPTAgentV2Presentation('1454'), undefined);
    fs.writeFileSync(file, JSON.stringify({ agentV2: { ...base, presets: [] } }));
    assert.equal(fastGPTAgentV2Presentation('1454'), undefined);
  } finally {
    if (previous === undefined) delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
    else process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
