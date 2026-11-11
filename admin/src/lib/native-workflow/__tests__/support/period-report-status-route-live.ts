/** Strict live-entry gate for the period-report status route database tests.
 *
 * Nothing here opens a connection. The real test file calls this before it
 * writes DATABASE_URL or creates a pool. A leftover B4 URL alone is not enough:
 * the operator must opt in explicitly. Once opted in, production and any
 * non-B target are rejected by the existing resolver before any connection.
 */
import {
  resolveB4DatabaseTarget,
  type B4LiveDatabaseTarget,
} from '../../live/dev-config';

export type PeriodReportStatusRouteLiveGate =
  | { readonly enabled: false; readonly reason: string }
  | { readonly enabled: true; readonly target: B4LiveDatabaseTarget };

export function resolvePeriodReportStatusRouteLiveGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
  argv: readonly string[] = process.argv,
): PeriodReportStatusRouteLiveGate {
  if (env.B4_LIVE_DEVELOPMENT !== '1' && !argv.includes('--development')) {
    return {
      enabled: false,
      reason: 'B4 live development entry is not enabled; set B4_LIVE_DEVELOPMENT=1 to run the database cases',
    };
  }
  // Explicitly enabled: production, missing/wrong B host/port/database/role and
  // any URL query/fragment fail here, before the caller can set DATABASE_URL.
  return { enabled: true, target: resolveB4DatabaseTarget({ purpose: 'app', env, argv }) };
}
