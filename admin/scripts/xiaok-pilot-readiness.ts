/** Read-only pilot readiness check for one explicitly named enterprise.
 *
 * Usage:
 *   npm run check:pilot-readiness -- --enterprise-id 123 --pilot-id first-pilot
 *
 * The command never creates, updates or deletes business data. It refuses to
 * run without an explicit enterprise id, so it cannot scan all enterprises by
 * accident. Exit code: 0 ready/limited, 2 blocked, 1 execution error. */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { checkPilotReadiness } from '@/lib/xiaok-v1/pilot-readiness';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(path.resolve(process.cwd()));

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        'enterprise-id': { type: 'string' }, enterpriseId: { type: 'string' },
        'pilot-id': { type: 'string' }, 'project-ids': { type: 'string' },
        'enterprise-audit': { type: 'boolean' },
      },
    });
    const enterpriseId = values['enterprise-id'] ?? values.enterpriseId;
    if (!enterpriseId) {
      throw new Error('Missing --enterprise-id. A single explicit enterprise is required; scanning all enterprises is not supported.');
    }
    const projectList = values['project-ids'];
    const report = await checkPilotReadiness({
      enterpriseId, pilotId: values['pilot-id'], enterpriseAudit: values['enterprise-audit'],
      projectIds: projectList === '' ? [] : projectList?.split(','),
    });
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
