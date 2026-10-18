#!/usr/bin/env node

import { register, tsImport } from 'tsx/esm/api';
import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.ASSISTANT_RETENTION_TS_BOOTSTRAPPED !== '1') {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ASSISTANT_RETENTION_TS_BOOTSTRAPPED: '1' },
    }
  );
  process.exitCode = child.status ?? 1;
} else {
  register();
  process.chdir(root);
  nextEnv.loadEnvConfig(root);

  const contract = await tsImport('../src/lib/assistant/retention/contract.ts', import.meta.url);
  const service = await tsImport('../src/lib/assistant/retention/service.ts', import.meta.url);
  const postgresql = await tsImport('../src/lib/postgresql.ts', import.meta.url);

  let exitCode = 0;
  try {
    const args = contract.parseRetentionCliArgs(process.argv.slice(2));
    const report = await service.runAssistantRetention({
      enterpriseId: args.enterpriseId,
      adminId: args.adminId,
      mode: args.mode,
      ...(args.afterConversationId ? { afterConversationId: args.afterConversationId } : {}),
      // A caller may pin the clock only for dry-runs. Apply always uses the
      // process/database current time and therefore cannot be moved into the
      // future by an operator flag.
      ...(args.mode === 'dry-run' && args.now ? { now: args.now } : {}),
    });
    console.log(JSON.stringify({ success: true, data: report }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('usage:')) console.log(message);
    else {
      console.error(JSON.stringify({ success: false, error: message }, null, 2));
      exitCode = 1;
    }
  } finally {
    await postgresql.closePostgresPool();
  }
  process.exitCode = exitCode;
}
