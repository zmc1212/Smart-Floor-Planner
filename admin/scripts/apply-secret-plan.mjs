#!/usr/bin/env node
/**
 * Applies a Secret Bootstrap production plan to a runtime env file without
 * overwriting existing valid secrets or printing secret values.
 *
 * Usage:
 *   node scripts/apply-secret-plan.mjs --plan <plan.env> --target <runtime.env> --check
 *   node scripts/apply-secret-plan.mjs --plan <plan.env> --target <runtime.env> --apply
 *
 * Only keys owned by the bootstrap (the five self-owned secrets and their
 * *_PREVIOUS slots) are accepted. A target that already holds a valid value is
 * never overwritten, so production rotation stays explicit.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  PREVIOUS_SUFFIX,
  SELF_OWNED_SECRETS,
  classifySecretValue,
  inspectFilePermissions,
  isGitIgnored,
  isGitTracked,
  mergeEnvText,
  parseEnvText,
  tightenFilePermissions,
} from './bootstrap-secrets.mjs';

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(adminRoot, '..');
export const MANAGED_KEYS = new Set(SELF_OWNED_SECRETS.flatMap((entry) => [
  entry.name, `${entry.name}${PREVIOUS_SUFFIX}`,
]));

/** Pure planner: decides which plan values may be written into the target. */
export function planApplication(targetEnv, planEnv) {
  const writes = [];
  const entries = [];
  const unsupported = [];
  for (const [name, value] of planEnv) {
    if (!MANAGED_KEYS.has(name)) {
      unsupported.push(name);
      continue;
    }
    const existing = targetEnv.get(name) ?? '';
    if (name.endsWith(PREVIOUS_SUFFIX)) {
      if (existing) entries.push({ name, status: 'kept_existing' });
      else {
        writes.push({ name, value });
        entries.push({ name, status: 'filled_previous' });
      }
      continue;
    }
    const meta = SELF_OWNED_SECRETS.find((entry) => entry.name === name);
    const verdict = classifySecretValue(existing, meta?.minLength);
    if (verdict.state === 'valid') {
      entries.push({ name, status: existing === value ? 'unchanged' : 'kept_existing' });
      continue;
    }
    writes.push({ name, value });
    entries.push({ name, status: verdict.state === 'missing' ? 'filled_missing' : 'replaced_invalid' });
  }
  return { writes, entries, unsupported };
}

function insideRepository(target) {
  const relative = path.relative(repoRoot, path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function applySecretPlan({
  planPath, targetPath, check = true, fixPermissions = false, exec,
  platform = process.platform,
} = {}) {
  const resolvedPlan = path.resolve(planPath);
  const resolvedTarget = path.resolve(targetPath);
  const result = {
    plan: resolvedPlan,
    target: resolvedTarget,
    check,
    changed: false,
    applied: false,
    entries: [],
    unsupported: [],
    safety: {},
    permissions: null,
  };
  const planText = await fs.readFile(resolvedPlan, 'utf8').catch(() => null);
  if (planText === null) return { ...result, error: 'plan_not_found' };
  const targetText = await fs.readFile(resolvedTarget, 'utf8').catch(() => null);
  if (targetText === null) return { ...result, error: 'target_not_found' };

  const plan = parseEnvText(planText);
  if (!plan.size) return { ...result, error: 'plan_empty' };
  const target = parseEnvText(targetText);
  const planned = planApplication(target, plan);
  result.entries = planned.entries;
  result.unsupported = planned.unsupported;
  if (planned.unsupported.length) return { ...result, error: 'unsupported_plan_key' };

  const inRepo = insideRepository(resolvedTarget);
  result.safety = {
    insideRepository: inRepo,
    gitIgnored: inRepo ? isGitIgnored(path.relative(adminRoot, resolvedTarget), exec) : null,
    gitTracked: inRepo ? isGitTracked(path.relative(adminRoot, resolvedTarget), exec) : false,
  };
  if (result.safety.gitTracked) return { ...result, error: 'target_tracked' };
  if (inRepo && result.safety.gitIgnored === false) return { ...result, error: 'target_not_ignored' };

  result.changed = planned.writes.length > 0;
  if (check || !result.changed) {
    result.permissions = await inspectFilePermissions(resolvedTarget, { platform }).catch(() => null);
    return result;
  }

  const merged = mergeEnvText(targetText, planned.writes);
  const temporary = `${resolvedTarget}.tmp-${process.pid}`;
  await fs.writeFile(temporary, merged, { mode: 0o600 });
  await fs.rename(temporary, resolvedTarget);
  result.applied = true;
  if (fixPermissions) {
    await tightenFilePermissions(resolvedTarget, { platform }).catch(() => undefined);
  }
  result.permissions = await inspectFilePermissions(resolvedTarget, { platform }).catch(() => null);
  return result;
}

function printHuman(result) {
  console.log(`[apply-secret-plan] target=${result.target} check=${result.check}`);
  for (const entry of result.entries) console.log(`- ${entry.name}: ${entry.status}`);
  if (result.unsupported.length) console.log(`- unsupported: ${result.unsupported.join(', ')}`);
  if (result.permissions) console.log(`- permissions: ${JSON.stringify(result.permissions)}`);
  if (result.error) console.log(`- error: ${result.error}`);
  console.log(`- changed=${result.changed} applied=${result.applied}`);
}

async function main() {
  const values = parseArgs({
    options: {
      plan: { type: 'string' },
      target: { type: 'string' },
      apply: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      'fix-permissions': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  }).values;
  if (!values.plan || !values.target) {
    console.error('[apply-secret-plan] --plan and --target are required');
    process.exitCode = 2;
    return;
  }
  const result = await applySecretPlan({
    planPath: values.plan,
    targetPath: values.target,
    check: !values.apply || values.check,
    fixPermissions: values['fix-permissions'],
  });
  if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  if (result.error) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[apply-secret-plan] failed: ${error?.message ?? 'unknown_error'}`);
    process.exitCode = 1;
  });
}
