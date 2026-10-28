import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { LocationService } from '@/lib/assistant/location/service';
import type { NearbyRegion } from '@/lib/assistant/location/region';
import type { ActorContext } from '@/lib/assistant/contracts';

let eid = '';
const actors: ActorContext[] = [], users: string[] = [];
const point = { latitude: 30.25, longitude: 120.13, coordinateSystem: 'gcj02' };
const config = async () => ({ key: 'synthetic-test-only', signingKey: '', license: '', validUntil: '', dailyLimit: 100 });
const region = (city = 'hangzhou'): NearbyRegion => city === 'hangzhou'
  ? { cityCode: '330100', cityName: '杭州市', district: '西湖区', source: 'wechat_location', resolvedAt: new Date().toISOString() }
  : { cityCode: '330200', cityName: '宁波市', district: '海曙区', source: 'wechat_location', resolvedAt: new Date().toISOString() };
function deferred() { let resolve!: (value: NearbyRegion) => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const result = new Promise<NearbyRegion>(r => { resolve = r; });
  return { started, resolve, provider: async () => { entered(); return result; } };
}
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  const prefix = 'SYNTHETIC-LOCATION-RACE-' + randomUUID();
  await withPlatformTransaction(async tx => {
    eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,1000000,100000000,30)`);
    for (let i = 0; i < 2; i++) { const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id); users.push(userId);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix + i})`);
      actors.push({ enterpriseId: eid, principal: { kind: 'user', userId }, contextVersion: 1, capabilities: ['assistant.chat.self'] }); }
  });
});
after(async () => { try { if (eid) await withPlatformTransaction(async tx => { await deleteAssistantData(tx, BigInt(eid));
  await tx.execute(sql`delete from app.enterprises where id=${eid}`); for (const user of users) await tx.execute(sql`delete from app.users where id=${user}`); }); }
finally { await closePostgresPool(); } });

test('clearing permission while the first lookup is pending fences its late result and remains repeatable', async () => {
  const cid = String((await new ConversationService(actors[0]).create(randomUUID())).id), gate = deferred();
  const location = new LocationService(actors[0], cid, { config, resolve: gate.provider });
  const pending = location.locate(point); await gate.started;
  await location.clear(); await location.clear(); gate.resolve(region());
  await assert.rejects(pending, /context_changed/); assert.equal((await location.read()).region, null);
});
test('a later lookup wins even when an earlier provider request completes last', async () => {
  const cid = String((await new ConversationService(actors[0]).create(randomUUID())).id), old = deferred(), latest = deferred();
  const first = new LocationService(actors[0], cid, { config, resolve: old.provider }), second = new LocationService(actors[0], cid, { config, resolve: latest.provider });
  const pendingOld = first.locate(point); await old.started;
  const pendingLatest = second.locate(point); await latest.started;
  latest.resolve(region('ningbo')); await pendingLatest;
  old.resolve(region()); await assert.rejects(pendingOld, /context_changed/);
  assert.equal((await first.read()).region?.cityCode, '330200');
});
test('a failed provider lookup clears the previous area without retaining coordinates', async () => {
  const cid = String((await new ConversationService(actors[1]).create(randomUUID())).id);
  await new LocationService(actors[1], cid, { config, resolve: async () => region() }).locate(point);
  const location = new LocationService(actors[1], cid, { config, resolve: async () => { throw Error('synthetic provider outage'); } });
  await assert.rejects(location.locate(point), /provider outage/); assert.equal((await location.read()).region, null);
  const snapshot = await withPlatformTransaction(tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${cid}`));
  assert.doesNotMatch(JSON.stringify(snapshot), /latitude|longitude|30\.25|120\.13/);
});
