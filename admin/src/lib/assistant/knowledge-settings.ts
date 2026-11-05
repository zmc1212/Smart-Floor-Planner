import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { authorizeKnowledgeManager } from './knowledge/manager';
import { fail } from './contracts';
import { enterpriseKnowledgeEnabled } from './knowledge-policy';

export class KnowledgeSettingsService {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}
  execute(input?: Record<string, unknown>) {
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const current = await one(tx, sql`select version,agent_config from app.assistant_enterprise_settings
        where enterprise_id=${this.enterpriseId} for update`);
      if (!current) fail('assistant_disabled', 409);
      const enabled = enterpriseKnowledgeEnabled(current.agent_config);
      if (!input) return { version: Number(current.version), enterpriseKnowledgeEnabled: enabled };
      if (Object.keys(input).length !== 2 || !Number.isInteger(input.expectedVersion)
        || typeof input.enterpriseKnowledgeEnabled !== 'boolean') fail('invalid_message', 422);
      if (input.enterpriseKnowledgeEnabled === enabled) return { version: Number(current.version), enterpriseKnowledgeEnabled: enabled };
      if (Number(current.version) !== input.expectedVersion) fail('version_conflict');
      const saved = await one(tx, sql`update app.assistant_enterprise_settings
        set agent_config=jsonb_set(coalesce(agent_config,'{}'::jsonb),'{enterpriseKnowledgeEnabled}',${JSON.stringify(input.enterpriseKnowledgeEnabled)}::jsonb),
        policy_version=policy_version+1,version=version+1,updated_at=now()
        where enterprise_id=${this.enterpriseId} returning version`);
      // Existing policy-version checks fence claims, dispatch and commits.
      return { version: Number(saved!.version), enterpriseKnowledgeEnabled: input.enterpriseKnowledgeEnabled };
    });
  }
}
