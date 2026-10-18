import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { configuredGuidance, validateGuidance } from './guidance';
import { fail } from '../contracts';
export class GuidanceSettingsService {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}
  execute(input?: Record<string, unknown>) {
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const current = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.enterpriseId} for update`);
      if (!current) fail('assistant_disabled', 409);
      if (!input) return { version: Number(current.version), config: configuredGuidance(current.guidance_config) };
      if (Object.keys(input).some(k => !['expectedVersion', 'config'].includes(k)) || !Number.isInteger(input.expectedVersion)) fail('invalid_message', 422);
      const config = validateGuidance(input.config);
      // A lost response may be retried without another write, but must not overwrite a later edit.
      if (JSON.stringify(config) === JSON.stringify(configuredGuidance(current.guidance_config))) return { version: Number(current.version), config };
      if (Number(current.version) !== input.expectedVersion) fail('version_conflict');
      const saved = await one(tx, sql`update app.assistant_enterprise_settings set guidance_config=${JSON.stringify(config)}::jsonb,
        version=version+1,updated_at=now() where enterprise_id=${this.enterpriseId} returning version`);
      return { version: Number(saved!.version), config };
    });
  }
}
