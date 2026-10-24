import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dir = path.join(root, 'tmp/anythingllm-pilot');
const privateFile = path.join(dir, 'instance.private.json');
fs.mkdirSync(dir, { recursive: true });
const config = fs.existsSync(privateFile)
  ? JSON.parse(fs.readFileSync(privateFile, 'utf8'))
  : { password: randomBytes(24).toString('hex'), jwtSecret: randomBytes(32).toString('hex'), bridgeKey: randomBytes(32).toString('hex') };
fs.writeFileSync(privateFile, JSON.stringify(config, null, 2), { mode: 0o600 });
const env = {
  STORAGE_DIR: '/app/server/storage',
  AUTH_TOKEN: config.password,
  JWT_SECRET: config.jwtSecret,
  DISABLE_TELEMETRY: 'true',
  LLM_PROVIDER: 'generic-openai',
  GENERIC_OPEN_AI_BASE_PATH: 'http://host.docker.internal:3109/v1',
  GENERIC_OPEN_AI_API_KEY: config.bridgeKey,
  GENERIC_OPEN_AI_MODEL_PREF: 'qwen3.7-flash',
  GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT: '32768',
  GENERIC_OPEN_AI_MAX_TOKENS: '2048',
  GENERIC_OPENAI_STREAMING_DISABLED: 'true',
  ANYTHINGLLM_MAX_RETRIES: '0',
  EMBEDDING_ENGINE: 'native',
  VECTOR_DB: 'lancedb',
  SFP_PILOT_BRIDGE: 'http://host.docker.internal:3109',
  SFP_PILOT_SECRET: config.bridgeKey,
};
fs.writeFileSync(path.join(dir, 'instance.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
const skillDir = path.join(dir, 'storage/plugins/agent-skills/sfp-renovation');
fs.mkdirSync(skillDir, { recursive: true });
for (const file of ['plugin.json', 'handler.js']) fs.copyFileSync(path.join(here, 'skill', file), path.join(skillDir, file));
console.log(JSON.stringify({ prepared: true, upstream: 'AnythingLLM v1.18.0', url: 'http://localhost:18093', credentialsPrinted: false }));
