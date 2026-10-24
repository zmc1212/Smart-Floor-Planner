import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export function preparePilot(dir = path.join(root, 'tmp/anythingllm-pilot')) {
const privateFile = path.join(dir, 'instance.private.json');
fs.mkdirSync(dir, { recursive: true });
const existingPrivate = fs.existsSync(privateFile);
const config = existingPrivate
  ? JSON.parse(fs.readFileSync(privateFile, 'utf8'))
  : { password: randomBytes(24).toString('hex'), jwtSecret: randomBytes(32).toString('hex'), bridgeKey: randomBytes(32).toString('hex') };
const envFile = path.join(dir, 'instance.env');
const previousEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const envValue = key => previousEnv.split(/\r?\n/).find(line => line.startsWith(key + '='))?.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
const migratingSessions = existingPrivate && !config.sigKey && !config.sigSalt;
const sigKey = config.sigKey || envValue('SIG_KEY');
const sigSalt = config.sigSalt || envValue('SIG_SALT');
assert.equal(Boolean(sigKey), Boolean(sigSalt), 'Incomplete encryption configuration; refusing to replace persistent keys');
assert.ok(sigKey || !fs.existsSync(path.join(dir, 'storage/anythingllm.db')), 'Existing database encryption keys are missing; restore them before preparing');
config.sigKey = sigKey || randomBytes(32).toString('hex');
config.sigSalt = sigSalt || randomBytes(32).toString('hex');
assert.ok(/^[a-f0-9]{64}$/i.test(config.sigKey) && /^[a-f0-9]{64}$/i.test(config.sigSalt), 'Invalid encryption configuration');
// Older prepares overwrote upstream-generated SIG keys. Invalidate only those
// legacy login sessions once, so undecryptable old cookies are rejected as 401.
// The local password, business bridge key and stored histories stay intact.
if (migratingSessions) config.jwtSecret = randomBytes(32).toString('hex');
fs.writeFileSync(privateFile, JSON.stringify(config, null, 2), { mode: 0o600 });
const env = {
  STORAGE_DIR: '/app/server/storage',
  AUTH_TOKEN: config.password,
  JWT_SECRET: config.jwtSecret,
  SIG_KEY: config.sigKey,
  SIG_SALT: config.sigSalt,
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
fs.writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
const skillDir = path.join(dir, 'storage/plugins/agent-skills/sfp-renovation');
fs.mkdirSync(skillDir, { recursive: true });
for (const file of ['plugin.json', 'handler.js']) fs.copyFileSync(path.join(here, 'skill', file), path.join(skillDir, file));
return { prepared: true, upstream: 'AnythingLLM v1.18.0', url: 'http://localhost:18093', credentialsPrinted: false, legacySessionsInvalidated: migratingSessions };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(preparePilot()));
