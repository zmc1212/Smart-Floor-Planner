import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import nextEnv from '@next/env';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root); nextEnv.loadEnvConfig(root, true);
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
const url = new URL(config.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '55432' || url.pathname !== '/xiaok_embedding_eval') throw Error('Isolated evaluation database required');
if (process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1' && process.env.ASSISTANT_P2M_LIVE === '1') {
  process.env.ASSISTANT_P2M_PRIMARY_DATABASE_URL = process.env.DATABASE_URL;
  process.env.ASSISTANT_TEXT_MODEL = 'deepseek-flash';
  process.env.ASSISTANT_TEXT_DISABLE_THINKING = '1';
}
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance();
try {
  const files = process.argv.length > 2 ? process.argv.slice(2) : ['assistant-agent.test.ts'];
  if (files.some(file => !/^assistant-(agent|requirements|answers|retention|media|handoff|references)\.test\.ts$/.test(file))) throw Error('Unsupported assistant regression file');
  // Same explicitly supported isolated-acceptance contract as assistant-operations-acceptance.mjs.
  // The URL/port/database guard and acceptance lock above must run before these flags are set.
  if (files.includes('assistant-retention.test.ts')) {
    process.env.ASSISTANT_RETENTION_DATABASE_URL = config.DATABASE_URL;
    process.env.ASSISTANT_OPERATIONS_ACCEPTANCE = '1';
  }
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...(process.env.ASSISTANT_P2M_TEST_PATTERN ? ['--test-name-pattern', process.env.ASSISTANT_P2M_TEST_PATTERN] : []), ...files.map(file => 'src/db/__tests__/' + file)], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', c => resolve(c ?? 1)); });
  if (process.env.ASSISTANT_P2M_DEEPSEEK_PROBE === '1' && process.env.ASSISTANT_P2M_LIVE === '1') {
    const promptVersion = fs.readFileSync('src/lib/assistant/agent/context.ts', 'utf8').match(/agentPromptVersion = '([^']+)'/)?.[1];
    const report = JSON.stringify({
      passed: process.exitCode === 0, agentPromptVersion: promptVersion, model: 'deepseek-flash', providerKey: 'deepseek',
      files, pattern: process.env.ASSISTANT_P2M_TEST_PATTERN || null, generatedAt: new Date().toISOString(), isolated: true, extended: process.env.ASSISTANT_P2M_EXTENDED === '1',
    }, null, 2);
    const target = '../tmp/xiaok-vector/p2m-live-' + promptVersion + '-deepseek-flash';
    fs.writeFileSync(target + '-' + Date.now() + '.json', report, { flag: 'wx' });
    // A filtered diagnostic must not replace the full-suite enablement evidence.
    if (!process.env.ASSISTANT_P2M_TEST_PATTERN) fs.writeFileSync(target + '.json', report);
  }
} finally { await release(); }
