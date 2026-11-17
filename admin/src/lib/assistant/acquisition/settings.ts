import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { fail } from '../contracts';
import { configuredAcquisition, validateAcquisitionConfig } from './config';

/** Read-only helper shared by code resolution and entry-context. Missing rows
 * fall back to the anonymous default instead of widening an enterprise scope. */
export async function readAcquisitionSettings(tx: PostgresTransaction, enterpriseId: string) {
  const current = await one(tx, sql`select version, acquisition_config from app.assistant_enterprise_settings
    where enterprise_id=${enterpriseId}`);
  return {
    version: Number(current?.version || 1),
    config: configuredAcquisition(current?.acquisition_config)
  };
}

export class AcquisitionSettingsService {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}

  execute(input?: Record<string, unknown>) {
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const current = await one(tx, sql`select version, acquisition_config from app.assistant_enterprise_settings
        where enterprise_id=${this.enterpriseId} for update`);
      if (!current) fail('assistant_disabled', 409);
      if (!input) {
        return { version: Number(current.version), config: configuredAcquisition(current.acquisition_config) };
      }
      if (Object.keys(input).some(key => !['expectedVersion', 'config'].includes(key))
        || !Number.isInteger(input.expectedVersion)) fail('invalid_message', 422);
      const config = validateAcquisitionConfig(input.config);
      // A lost response may be retried without another write, but must not
      // overwrite a later edit.
      if (JSON.stringify(config) === JSON.stringify(configuredAcquisition(current.acquisition_config))) {
        return { version: Number(current.version), config };
      }
      if (Number(current.version) !== input.expectedVersion) fail('version_conflict');
      const saved = await one(tx, sql`update app.assistant_enterprise_settings
        set acquisition_config=${JSON.stringify(config)}::jsonb, version=version+1, updated_at=now()
        where enterprise_id=${this.enterpriseId} returning version`);
      return { version: Number(saved!.version), config };
    });
  }
}
