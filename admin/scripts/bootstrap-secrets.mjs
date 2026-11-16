#!/usr/bin/env node
/**
 * Idempotent bootstrap for every self-owned secret. It never prints secret
 * values, never overwrites a valid secret, and never writes `.env.production`.
 *
 * Local mode (default) generates or rotates self-owned secrets in a local env
 * file. Rotating an encryption-capable key keeps the old value in
 * `<NAME>_PREVIOUS`, which `src/lib/crypto.ts` still reads, so historical
 * ciphertext stays decryptable.
 *
 * Production mode (`--production-plan`) only writes an injection plan to a
 * path outside the repository. The production env file is read, never written.
 *
 * Usage:
 *   node scripts/bootstrap-secrets.mjs
 *   node scripts/bootstrap-secrets.mjs --check --json
 *   node scripts/bootstrap-secrets.mjs --env-file .env.test
 *   node scripts/bootstrap-secrets.mjs --production-plan
 *   node scripts/bootstrap-secrets.mjs --production-plan --plan-output C:\secrets\sfp.env
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(adminRoot, '..');

const PLACEHOLDER = /(replace|your_|example|change_me|placeholder)/i;
const KNOWN_INSECURE = new Set([
  '123456',
  'fallback_secret_random_123',
  'smart-floor-planner-pollinations-secret',
  'local-dev-credential-encryption-only',
]);
export const PREVIOUS_SUFFIX = '_PREVIOUS';
export const MIN_SECRET_LENGTH = 32;
export const SECRET_BYTES = 48;
export const PLAN_HEADER = 'SFP production secret injection plan';

/** Self-owned secrets. `encryption` keys can have historical ciphertext. */
export const SELF_OWNED_SECRETS = Object.freeze([
  { name: 'JWT_SECRET', minLength: MIN_SECRET_LENGTH, encryption: true },
  { name: 'INTERNAL_SECRET', minLength: MIN_SECRET_LENGTH, encryption: false },
  { name: 'AI_PROVIDER_KEY_ENCRYPTION_SECRET', minLength: MIN_SECRET_LENGTH, encryption: true },
  { name: 'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET', minLength: MIN_SECRET_LENGTH, encryption: true },
  { name: 'CRON_SECRET', minLength: MIN_SECRET_LENGTH, encryption: false },
]);

/** Third-party credentials are reported, never generated and never blocking. */
export const THIRD_PARTY_SECRETS = Object.freeze([
  'ASSISTANT_BAILIAN_RAG_WORKSPACE_ID',
  'ASSISTANT_BAILIAN_RAG_API_KEY',
  'ASSISTANT_EMBEDDING_URL',
  'ASSISTANT_EMBEDDING_API_KEY',
  'WX_APPID',
  'WX_APPSECRET',
  'DEPLOY_SMOKE_USERNAME',
  'DEPLOY_SMOKE_PASSWORD',
]);

/** Highest priority rotates first, so JWT stays as the legacy anchor longest. */
const DUPLICATE_ROTATION_ORDER = [
  'CRON_SECRET',
  'INTERNAL_SECRET',
  'AI_PROVIDER_KEY_ENCRYPTION_SECRET',
  'MEDIA_STORAGE_KEY_ENCRYPTION_SECRET',
  'JWT_SECRET',
];

export function generateSecret(bytes = SECRET_BYTES) {
  return randomBytes(bytes).toString('base64url');
}

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

export function normalizeEnvValue(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Parses dotenv text into a key/value map; ignores comments and blank lines. */
export function parseEnvText(text) {
  const values = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values.set(match[1], normalizeEnvValue(match[2]));
  }
  return values;
}

export function classifySecretValue(value, minLength = MIN_SECRET_LENGTH) {
  if (typeof value !== 'string' || value.length === 0) {
    return { state: 'missing', reason: 'missing' };
  }
  if (PLACEHOLDER.test(value)) return { state: 'invalid', reason: 'placeholder' };
  if (KNOWN_INSECURE.has(value)) return { state: 'invalid', reason: 'known_insecure' };
  if (value.length < minLength) return { state: 'invalid', reason: 'too_short' };
  return { state: 'valid', reason: null };
}

export function findDuplicateGroups(values) {
  const byValue = new Map();
  for (const meta of SELF_OWNED_SECRETS) {
    const value = values.get(meta.name);
    if (!value) continue;
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(meta.name);
  }
  return [...byValue.values()].filter((names) => names.length > 1);
}

export function thirdPartyStatus(env) {
  return THIRD_PARTY_SECRETS.map((name) => {
    const value = env.get(name) ?? '';
    const configured = value.length > 0 && !PLACEHOLDER.test(value);
    return { name, status: configured ? 'configured' : 'pending' };
  });
}

/**
 * Pure planner. Never mutates the input and never returns existing values.
 * It returns the values to write so the caller can decide whether to apply.
 */
export function planSecrets(envInput, { generate = generateSecret } = {}) {
  const env = envInput instanceof Map ? envInput : new Map(Object.entries(envInput ?? {}));
  const finalValues = new Map();
  const entries = [];
  const writes = [];
  const previousWrites = [];
  const blocked = new Set();

  for (const meta of SELF_OWNED_SECRETS) {
    const current = env.get(meta.name) ?? '';
    const verdict = classifySecretValue(current, meta.minLength);
    if (verdict.state === 'valid') {
      finalValues.set(meta.name, current);
      entries.push({
        name: meta.name, status: 'valid', action: 'keep', reason: null,
        length: current.length, fingerprint: fingerprint(current), encryption: meta.encryption,
      });
      continue;
    }
    const action = verdict.state === 'missing' ? 'generate' : 'rotate';
    const previousName = meta.name + PREVIOUS_SUFFIX;
    if (meta.encryption && current) {
      const existingPrevious = env.get(previousName) ?? '';
      if (existingPrevious) {
        blocked.add(meta.name);
        finalValues.set(meta.name, current);
        entries.push({
          name: meta.name, status: 'blocked', action: 'blocked',
          reason: 'previous_secret_already_present', length: current.length,
          fingerprint: fingerprint(current), encryption: true,
        });
        continue;
      }
      previousWrites.push({ name: previousName, value: current });
    }
    const value = generate();
    finalValues.set(meta.name, value);
    writes.push({ name: meta.name, value });
    entries.push({
      name: meta.name, status: action === 'generate' ? 'generated' : 'rotated',
      action, reason: verdict.reason, length: value.length,
      fingerprint: fingerprint(value), encryption: meta.encryption,
    });
  }

  // Resolve duplicates among final values by rotating the lowest-priority key.
  const rotated = new Set();
  for (let attempt = 0; attempt < SELF_OWNED_SECRETS.length * 2; attempt += 1) {
    const duplicates = findDuplicateGroups(finalValues)
      .filter((names) => names.some((name) => !blocked.has(name)));
    if (duplicates.length === 0) break;
    const group = duplicates[0];
    const candidate = DUPLICATE_ROTATION_ORDER
      .find((name) => group.includes(name) && !blocked.has(name) && !rotated.has(name));
    if (!candidate) break;
    const meta = SELF_OWNED_SECRETS.find((entry) => entry.name === candidate);
    const oldValue = finalValues.get(candidate);
    const previousName = meta.name + PREVIOUS_SUFFIX;
    if (meta.encryption && oldValue) {
      const existingPrevious = env.get(previousName) ?? '';
      const earlierWrite = previousWrites.find((entry) => entry.name === previousName);
      if (existingPrevious || earlierWrite) {
        blocked.add(meta.name);
        continue;
      }
      previousWrites.push({ name: previousName, value: oldValue });
    }
    const value = generate();
    finalValues.set(candidate, value);
    rotated.add(candidate);
    const writeIndex = writes.findIndex((entry) => entry.name === candidate);
    if (writeIndex >= 0) writes[writeIndex] = { name: candidate, value };
    else writes.push({ name: candidate, value });
    const entry = entries.find((item) => item.name === candidate);
    if (entry) {
      entry.status = 'rotated';
      entry.action = 'rotate';
      entry.reason = 'duplicate_secret';
      entry.length = value.length;
      entry.fingerprint = fingerprint(value);
    }
  }

  const unresolvedDuplicates = findDuplicateGroups(finalValues);
  return {
    entries,
    writes,
    previousWrites,
    duplicates: unresolvedDuplicates,
    thirdParty: thirdPartyStatus(env),
    blocked: [...blocked],
    changed: writes.length > 0 || previousWrites.length > 0,
  };
}

function quoteValue(value) {
  return `"${value}"`;
}

/**
 * Merges plan writes into dotenv text. Existing keys are replaced in place,
 * their quote style is kept, and unrelated lines remain untouched.
 */
export function mergeEnvText(text, writes, { now = new Date() } = {}) {
  const source = String(text ?? '');
  const lines = source.length ? source.split(/\r?\n/) : [];
  const pending = new Map(writes.map((entry) => [entry.name, entry.value]));
  const output = [];
  for (const line of lines) {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || !pending.has(match[2])) {
      output.push(line);
      continue;
    }
    const rawValue = match[4].trim();
    const hadQuotes = rawValue.startsWith('"') || rawValue.startsWith("'");
    const value = pending.get(match[2]);
    pending.delete(match[2]);
    output.push(`${match[1]}${match[2]}${match[3]}${hadQuotes ? quoteValue(value) : value}`);
  }
  if (pending.size) {
    if (output.length && output[output.length - 1] !== '') output.push('');
    output.push(`# Self-owned secrets generated by scripts/bootstrap-secrets.mjs (${now.toISOString().slice(0, 10)}).`);
    for (const [name, value] of pending) output.push(`${name}=${quoteValue(value)}`);
  }
  const trailing = source.endsWith('\n') || source.length === 0;
  return output.join('\n') + (trailing ? '\n' : '');
}

export function isInsideRepository(target, root = repoRoot) {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: adminRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options,
  }).toString();
}

export function isGitIgnored(file, exec = run) {
  try {
    exec('git', ['check-ignore', '-q', '--', file]);
    return true;
  } catch (error) {
    return error?.status === 1 ? false : null;
  }
}

export function isGitTracked(file, exec = run) {
  try {
    exec('git', ['ls-files', '--error-unmatch', '--', file]);
    return true;
  } catch (error) {
    return error?.status === 1 ? false : null;
  }
}

export function evaluateAclEntries(entries) {
  const broadIdentities = [
    'everyone', 'authenticated users', 'builtin\\users', 'nt authority\\authenticated users',
  ];
  const broadWrite = entries.some((entry) => entry.type === 'Allow'
    && /[FMW]/i.test(entry.rights)
    && broadIdentities.some((identity) => entry.identity.toLowerCase().includes(identity)));
  const broadRead = entries.some((entry) => entry.type === 'Allow'
    && broadIdentities.some((identity) => entry.identity.toLowerCase().includes(identity)));
  return { broadWrite, broadRead, entryCount: entries.length };
}

function readWindowsAcl(file, exec = run) {
  const output = exec('icacls.exe', [file]);
  return parseIcaclsOutput(output, file);
}

/** Parses `icacls <file>` output into ACL entries without a PowerShell dependency. */
export function parseIcaclsOutput(text, file) {
  const entries = [];
  const normalizedFile = String(file).toLowerCase();
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^Successfully processed/i.test(line)) continue;
    if (line.toLowerCase().startsWith(normalizedFile)) line = line.slice(String(file).length).trim();
    const match = line.match(/^(.+?):((?:\([^)]+\))+)$/);
    if (!match) continue;
    const flags = [...match[2].matchAll(/\(([^)]+)\)/g)].map((item) => item[1]);
    entries.push({
      identity: match[1].trim(),
      rights: flags.join(','),
      type: flags.includes('DENY') ? 'Deny' : 'Allow',
      inherited: flags.includes('I'),
    });
  }
  return entries;
}

export async function inspectFilePermissions(file, {
  platform = process.platform, exec = run,
} = {}) {
  const stats = await fs.stat(file);
  if (platform !== 'win32') {
    const mode = stats.mode & 0o777;
    return {
      platform, mode: mode.toString(8), broadWrite: (mode & 0o022) !== 0,
      broadRead: (mode & 0o077) !== 0, restricted: (mode & 0o077) === 0,
    };
  }
  const acl = readWindowsAcl(file, exec);
  const evaluated = evaluateAclEntries(acl);
  return {
    platform, restricted: !evaluated.broadWrite,
    broadWrite: evaluated.broadWrite, broadRead: evaluated.broadRead,
    entryCount: evaluated.entryCount,
  };
}

export async function tightenFilePermissions(file, {
  platform = process.platform, exec = run,
} = {}) {
  if (platform !== 'win32') {
    await fs.chmod(file, 0o600);
    return { applied: true, mode: '600' };
  }
  const sidLine = exec('whoami.exe', ['/user', '/fo', 'csv', '/nh']).trim();
  const sid = sidLine.split(',').pop().replaceAll('"', '').trim();
  exec('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '*S-1-5-18:(F)', '*S-1-5-32-544:(F)']);
  return { applied: true, mode: 'restricted-acl' };
}

function publicEntry(entry) {
  return {
    name: entry.name, status: entry.status, action: entry.action, reason: entry.reason,
    length: entry.length, fingerprint: entry.fingerprint, encryption: entry.encryption,
  };
}

export async function runBootstrap({
  envFile, mode = 'local', check = false, fixPermissions = false,
  planOutput, now = new Date(), generate = generateSecret, exec = run, platform = process.platform,
} = {}) {
  const resolvedEnvFile = path.resolve(envFile);
  const gitPath = path.relative(adminRoot, resolvedEnvFile);
  const exists = await fs.stat(resolvedEnvFile).then((stats) => stats.isFile()).catch(() => false);
  const text = exists ? await fs.readFile(resolvedEnvFile, 'utf8') : '';
  const env = parseEnvText(text);
  const plan = planSecrets(env, { generate });

  const gitIgnored = isGitIgnored(gitPath, exec);
  const gitTracked = isGitTracked(gitPath, exec);
  const safety = {
    envFile: path.relative(repoRoot, resolvedEnvFile),
    exists,
    gitIgnored,
    gitTracked,
    insideRepository: isInsideRepository(resolvedEnvFile),
  };

  const result = {
    mode,
    envFile: path.relative(repoRoot, resolvedEnvFile),
    check,
    changed: false,
    applied: false,
    safety,
    permissions: null,
    entries: plan.entries.map(publicEntry),
    previous: plan.previousWrites.map((entry) => ({ name: entry.name, status: 'planned' })),
    duplicates: plan.duplicates,
    blocked: plan.blocked,
    thirdParty: plan.thirdParty,
    planOutput: null,
  };

  if (mode === 'production') {
    if (plan.blocked.length) {
      result.error = 'rotation_blocked';
      return result;
    }
    if (!plan.changed) {
      result.reason = 'plan_not_required';
      return result;
    }
    const output = planOutput
      ? path.resolve(planOutput)
      : path.join(os.homedir(), '.sfp-secrets', 'sfp-production-secrets.env');
    if (isInsideRepository(output)) {
      result.error = 'plan_output_inside_repository';
      return result;
    }
    if (!check) {
      const existingPlan = await fs.readFile(output, 'utf8')
        .then((value) => parseEnvText(value))
        .catch(() => new Map());
      const finalWrites = plan.writes.map((write) => {
        const meta = SELF_OWNED_SECRETS.find((entry) => entry.name === write.name);
        const existing = existingPlan.get(write.name) ?? '';
        return classifySecretValue(existing, meta?.minLength ?? MIN_SECRET_LENGTH).state === 'valid'
          ? { name: write.name, value: existing }
          : write;
      });
      const previousNames = plan.previousWrites.map((entry) => entry.name);
      const planUnchanged = finalWrites.every((write) => existingPlan.get(write.name) === write.value)
        && plan.previousWrites.every((write) => existingPlan.get(write.name) === write.value)
        && existingPlan.size > 0;
      result.planReused = planUnchanged;
      result.planOutput = output;
      result.pendingChanges = plan.changed;
      if (planUnchanged) {
        const reused = new Set(finalWrites.map((write) => write.name));
        result.entries = plan.entries.map((entry) => {
          if (!reused.has(entry.name)) return publicEntry(entry);
          const value = existingPlan.get(entry.name) ?? '';
          return {
            ...publicEntry(entry), status: 'reused', action: 'keep', reason: 'plan_reused',
            length: value.length, fingerprint: fingerprint(value),
          };
        });
      }
      if (!planUnchanged) {
        await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
        const lines = [
          `# ${PLAN_HEADER}`,
          `# Generated ${now.toISOString()} from ${path.basename(resolvedEnvFile)}.`,
          '# Merge these lines into the approved runtime secret store; do not replace the whole env file.',
          '# Existing valid secrets are intentionally omitted. Values are never printed by the tool.',
          '',
        ];
        for (const write of plan.previousWrites) lines.push(`${write.name}=${quoteValue(write.value)}`);
        for (const write of finalWrites) lines.push(`${write.name}=${quoteValue(write.value)}`);
        await fs.writeFile(output, lines.join('\n') + '\n', { mode: 0o600 });
      }
      result.permissions = await inspectFilePermissions(output, { platform, exec }).catch(() => null);
      if (platform !== 'win32' || result.permissions?.broadRead) {
        await tightenFilePermissions(output, { platform, exec }).catch(() => undefined);
        result.permissions = await inspectFilePermissions(output, { platform, exec }).catch(() => null);
      }
      result.previous = previousNames.map((name) => ({ name, status: planUnchanged ? 'reused' : 'planned' }));
    }
    result.changed = !result.planReused && plan.changed;
    result.applied = !check && !result.planReused && plan.changed;
    return result;
  }

  if (result.safety.gitTracked) {
    result.error = 'env_file_tracked';
    return result;
  }
  if (result.safety.gitIgnored === false) {
    result.error = 'env_file_not_ignored';
    return result;
  }

  if (check) {
    result.changed = plan.changed;
    return result;
  }

  if (plan.changed) {
    const next = mergeEnvText(text, [...plan.previousWrites, ...plan.writes], { now });
    const temporary = `${resolvedEnvFile}.tmp-${process.pid}`;
    await fs.mkdir(path.dirname(resolvedEnvFile), { recursive: true });
    await fs.writeFile(temporary, next, { mode: 0o600 });
    await fs.rename(temporary, resolvedEnvFile);
    result.applied = true;
    result.changed = true;
  } else {
    result.changed = false;
  }

  result.permissions = await inspectFilePermissions(resolvedEnvFile, { platform, exec }).catch(() => null);
  if (fixPermissions) {
    await tightenFilePermissions(resolvedEnvFile, { platform, exec }).catch(() => undefined);
    result.permissions = await inspectFilePermissions(resolvedEnvFile, { platform, exec }).catch(() => null);
  }
  return result;
}

function printHuman(result) {
  console.log(`[bootstrap-secrets] mode=${result.mode} env=${result.envFile}`);
  for (const entry of result.entries) {
    console.log(`- ${entry.name}: ${entry.status}${entry.reason ? ` (${entry.reason})` : ''} length=${entry.length} fp=${entry.fingerprint}`);
  }
  if (result.previous.length) {
    console.log(`- previous values preserved: ${result.previous.map((entry) => entry.name).join(', ')}`);
  }
  if (result.duplicates.length) {
    console.log(`- duplicate groups unresolved: ${result.duplicates.map((group) => group.join('=')).join('; ')}`);
  }
  const pending = result.thirdParty.filter((entry) => entry.status === 'pending').map((entry) => entry.name);
  console.log(`- third-party pending: ${pending.length ? pending.join(', ') : 'none'}`);
  if (result.permissions) {
    console.log(`- permissions: ${JSON.stringify(result.permissions)}`);
  }
  if (result.error) console.log(`- error: ${result.error}`);
  if (result.planOutput) console.log(`- production plan written outside the repository: ${result.planOutput}`);
  if (result.planReused) console.log('- existing production plan reused without changes');
  console.log(`- changed=${result.changed} applied=${result.applied} check=${result.check}`);
}

async function main() {
  const values = parseArgs({
    options: {
      'env-file': { type: 'string' },
      'production-plan': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'fix-permissions': { type: 'boolean', default: false },
      'plan-output': { type: 'string' },
    },
  }).values;
  const mode = values['production-plan'] ? 'production' : 'local';
  const envFile = values['env-file']
    ? path.resolve(process.cwd(), values['env-file'])
    : path.join(adminRoot, mode === 'production' ? '.env.production' : '.env.local');
  const result = await runBootstrap({
    envFile, mode, check: values.check,
    fixPermissions: values['fix-permissions'], planOutput: values['plan-output'],
  });
  if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  if (result.error) process.exitCode = 1;
  else if (result.check && result.entries.some((entry) => entry.status !== 'valid')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[bootstrap-secrets] failed: ${error?.message ?? 'unknown_error'}`);
    process.exitCode = 1;
  });
}
