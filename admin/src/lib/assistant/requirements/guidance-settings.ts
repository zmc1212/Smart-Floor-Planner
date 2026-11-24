import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { configuredPublicSiteGuide, validatePublicSiteGuide, type PublicSiteGuide } from '@/lib/construction/public-guide';
import { authorizeKnowledgeManager } from '../knowledge/manager';
import { configuredGuidance, validateGuidance, type Guidance } from './guidance';
import { fail } from '../contracts';
export class GuidanceSettingsService {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}
  execute(input?: Record<string, unknown>): Promise<{ version: number; config: Guidance }>;
  execute(input: Record<string, unknown> | undefined, scene: 'public-site'): Promise<{ version: number; config: PublicSiteGuide }>;
  execute(input?: Record<string, unknown>, scene?: 'public-site') {
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const current = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.enterpriseId} for update`);
      if (!current) fail('assistant_disabled', 409);
      const stored = current.guidance_config;
      const previous = scene === 'public-site' ? configuredPublicSiteGuide(stored) : configuredGuidance(stored);
      if (!input) return { version: Number(current.version), config: previous };
      if (Object.keys(input).some(k => !['expectedVersion', 'config'].includes(k)) || !Number.isInteger(input.expectedVersion)) fail('invalid_message', 422);
      const config = scene === 'public-site' ? validatePublicSiteGuide(input.config) : validateGuidance(input.config);
      // A lost response may be retried without another write, but must not overwrite a later edit.
      if (JSON.stringify(config) === JSON.stringify(previous)) return { version: Number(current.version), config };
      if (Number(current.version) !== input.expectedVersion) fail('version_conflict');
      const publicSiteGuide = (stored as { publicSiteGuide?: unknown } | null)?.publicSiteGuide;
      const next = scene === 'public-site' ? { ...(stored as object | null), publicSiteGuide: config }
        : { ...config, ...(publicSiteGuide === undefined ? {} : { publicSiteGuide }) };
      const saved = await one(tx, sql`update app.assistant_enterprise_settings set guidance_config=${JSON.stringify(next)}::jsonb,
        version=version+1,updated_at=now() where enterprise_id=${this.enterpriseId} returning version`);
      return { version: Number(saved!.version), config };
    });
  }
}
