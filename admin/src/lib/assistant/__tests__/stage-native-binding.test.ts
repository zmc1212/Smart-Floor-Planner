import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nativeAgentRuntimeBinding } from '../fastgpt/agent-v2/config';

test('a stage Agent can use its enterprise native runtime without a FastGPT bridge', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiaok-stage-binding-'));
  const file = path.join(directory, 'runtime.json');
  const previous = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  t.after(() => {
    if (previous === undefined) delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
    else process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previous;
    rmSync(file, { force: true });
    rmdirSync(directory);
  });
  process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = file;
  const config = { protocol: 'fastgpt-agent-v2-v1', enterpriseId: '1454', runtime: 'langgraph-v1' };
  const save = (agentV2: unknown) => writeFileSync(file, JSON.stringify({ agentV2 }));
  save(config);
  const initial = nativeAgentRuntimeBinding('1454');
  assert.equal(initial?.configuration.runtime, 'langgraph-v1');
  assert.equal(nativeAgentRuntimeBinding('1455'), undefined);

  save([{ ...config, enterpriseId: '1455' }, config]);
  assert.equal(nativeAgentRuntimeBinding('1454')?.binding, initial?.binding);
  save([config, config]);
  assert.throws(() => nativeAgentRuntimeBinding('1454'), /context_changed/);
  save({ ...config, presets: [''] });
  assert.throws(() => nativeAgentRuntimeBinding('1454'), /context_changed/);
});
