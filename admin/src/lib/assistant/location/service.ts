import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, principalKey, requireCapability, type ActorContext } from '../contracts';
import { getCommunityRuntimeConfig } from '@/lib/map-services/config';
import type { CommunityProviderConfig } from '@/lib/portfolio/community-provider';
import { coordinates, reverseRegion, type Coordinates } from './geocode';
import { nearbyRegion, type NearbyRegion } from './region';

export class LocationService {
  constructor(readonly actor: ActorContext, readonly conversationId: string,
    private readonly dependencies: { config?: () => Promise<CommunityProviderConfig>; resolve?: (input: Coordinates, config: CommunityProviderConfig) => Promise<NearbyRegion> } = {}) {
    id(conversationId); requireCapability(actor, 'assistant.chat.self');
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  }
  private scope<T>(run: (tx: PostgresTransaction, c: Row) => Promise<T>, write = false) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor); const settings = await repo.settings(write);
      if (!settings?.enabled) fail('assistant_disabled', 403);
      const c = await repo.conversation(this.conversationId);
      return run(tx, c);
    });
  }
  read() { return this.scope(async (_tx, c) => ({ region: nearbyRegion(c.entry_snapshot) })); }
  clear() {
    return this.scope(async (tx, c) => {
      const entry = c.entry_snapshot as Row;
      if (!entry?.nearbyRegion && !entry?.nearbyLocationRequest) return { region: null };
      // Revocation invalidates in-flight answers through the existing revision guard.
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'nearbyRegion'-'nearbyLocationRequest',context_revision=context_revision+1,version=version+1
        where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
      return { region: null };
    });
  }
  async locate(input: unknown) {
    const point = coordinates(input), requestId = randomUUID();
    await this.scope(async (tx, c) => {
      if (c.status !== 'open') fail('conversation_read_only');
      // A nonce fences a delayed provider result after denial, reentry or a
      // newer lookup; it contains no coordinates and never enters model data.
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{nearbyLocationRequest}',${JSON.stringify(requestId)}::jsonb)
        where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
    });
    try {
      const config = await (this.dependencies.config || getCommunityRuntimeConfig)();
      await this.scope(async (tx, c) => {
        if ((c.entry_snapshot as Row).nearbyLocationRequest !== requestId) fail('context_changed');
        if (c.status !== 'open') fail('conversation_read_only');
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'assistant-location:' + this.actor.enterpriseId},0))`);
        const usage = await one(tx, sql`select count(*)::int as day_count,count(*) filter(where principal_key=${principalKey(this.actor)} and created_at>now()-interval '1 minute')::int as recent
          from app.assistant_idempotency_records where enterprise_id=${this.actor.enterpriseId} and operation='location.lookup'
          and created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`);
        if (Number(usage?.recent) >= 3 || Number(usage?.day_count) >= config.dailyLimit) fail('location_rate_limited', 429);
        await tx.execute(sql`insert into app.assistant_idempotency_records(enterprise_id,principal_key,operation,key,request_hash,result,expires_at)
          values(${this.actor.enterpriseId},${principalKey(this.actor)},'location.lookup',${requestId},${fingerprint({ operation: 'location.lookup' })},'{}'::jsonb,now()+interval '1 day')`);
      });
      const region = await (this.dependencies.resolve || reverseRegion)(point, config);
      if (!nearbyRegion({ nearbyRegion: region })) fail('location_unavailable', 503);
      return await this.scope(async (tx, c) => {
        if ((c.entry_snapshot as Row).nearbyLocationRequest !== requestId) fail('context_changed');
        if (c.status !== 'open') fail('conversation_read_only');
        if (!this.dependencies.config) {
          await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended('platform-map-services',0))`);
          if (fingerprint(await getCommunityRuntimeConfig(tx)) !== fingerprint(config)) fail('context_changed');
        }
        await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot-'nearbyLocationRequest','{nearbyRegion}',${JSON.stringify(region)}::jsonb),
          context_revision=context_revision+1,version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
        return { region };
      }, true);
    } catch (error) {
      // Clear this request's stale context, never a newer successful lookup.
      try { await this.scope(async (tx, c) => {
        if ((c.entry_snapshot as Row).nearbyLocationRequest !== requestId) return;
        await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'nearbyRegion'-'nearbyLocationRequest',context_revision=context_revision+1,version=version+1
          where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
      }); } catch { /* A disconnected client can repeat DELETE after recovery. */ }
      throw error;
    }
  }
}
