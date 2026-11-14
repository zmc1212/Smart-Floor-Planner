/** Read-only pilot readiness check for one explicitly named enterprise.
 *
 * Usage:
 *   npm run check:pilot-readiness -- --enterprise-id 123
 *
 * The command never creates, updates or deletes business data. It refuses to
 * run without an explicit enterprise id, so it cannot scan all enterprises by
 * accident. Exit code: 0 ready/limited, 2 blocked, 1 execution error. */
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { checkPilotReadiness } from '@/lib/xiaok-v1/pilot-readiness';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(path.resolve(process.cwd()));

function argument(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

async function main() {
  try {
    const enterpriseId = argument('--enterprise-id') ?? argument('--enterpriseId');
    if (!enterpriseId) {
      throw new Error('Missing --enterprise-id. A single explicit enterprise is required; scanning all enterprises is not supported.');
    }
    if (!/^[1-9]\d*$/u.test(enterpriseId)) {
      throw new Error('--enterprise-id must be a positive bigint.');
    }
    const report = await checkPilotReadiness({ enterpriseId });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.readiness === 'blocked' ? 2 : 0;
  } finally {
    await closePostgresPool();
  }
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(JSON.stringify({
    readiness: 'blocked',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
