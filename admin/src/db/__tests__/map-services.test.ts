import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { one } from '@/db/repositories/assistant-repository';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { PlatformConfigRepository } from '@/db/repositories/platform-config-repository';
import { withPlatformTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { getCommunityRuntimeConfig, getPlatformMapConfig, importEnvironmentMapConfig, savePlatformMapConfig, testPlatformMapConnection, validateMapConfigInput, type MapConfigInput } from '@/lib/map-services/config';
import { mapConfigHttp } from '@/lib/map-services/http';
import { PortfolioService } from '@/lib/portfolio/service';
import { createCommunityProvider } from '@/lib/map-services/providers';
import { AmapCommunityProvider } from '@/lib/portfolio/community-provider';

let enterprise: string, admin: string, merchant: string, designer: string, disabled: string;
let original: Record<string, unknown> | null, version = 0;
const envKeys = ['AMAP_WEB_SERVICE_KEY', 'AMAP_COMMERCIAL_LICENSE_CONFIRMED', 'AMAP_BINDING_RIGHTS_CONFIRMED', 'AMAP_LICENSE_REFERENCE', 'AMAP_RIGHTS_VALID_UNTIL', 'JWT_SECRET'];
const priorEnvironment = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
const rawKey = 'private-map-fixture-key-32', signingKey = 'private-signing-fixture';
const rights = { commercialConfirmed: true, bindingConfirmed: true, reference: 'isolated-fixture-only', validUntil: '2099-01-01T00:00:00Z' };
const input = (extra: Partial<MapConfigInput> = {}): MapConfigInput => ({ expectedVersion: version, enabled: false, activeProvider: 'amap', dailyLimit: 1000, rights, ...extra });
const poi = { id: 'B0FFTEST001', name: '测试花园', typecode: '120302', adcode: '420502', cityname: '宜昌市', adname: '西陵区', address: '测试路' };
const response = () => Response.json({ status: '1', pois: [poi] });
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  process.env.JWT_SECRET = 'map-services-isolated-test-only'; process.env.AMAP_WEB_SERVICE_KEY = rawKey;
  await withPlatformTransaction(async tx => {
    const repo = new PlatformConfigRepository(tx), row = await repo.ensureForUpdate('default'); original = row.mapServiceConfig;
    await repo.update('default', { mapServiceConfig: {} });
    const prefix = 'map-' + randomUUID();
    enterprise = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!.id);
    const ids: string[] = [];
    for (const [i, role] of ['admin', 'enterprise_admin', 'designer', 'admin'].entries()) {
      ids.push(String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password) values(${enterprise},${prefix + i},'test-only',${role},${i === 3 ? 'disabled' : 'active'},false) returning id`))!.id));
    }
    [admin, merchant, designer, disabled] = ids;
  });
});
after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      await new PlatformConfigRepository(tx).update('default', { mapServiceConfig: original || {} });
      if (enterprise) { await deletePortfolioData(tx, BigInt(enterprise)); await deleteAssistantData(tx, BigInt(enterprise)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterprise}`); await tx.execute(sql`delete from app.enterprises where id=${enterprise}`); }
    });
  } finally { for (const k of envKeys) { if (priorEnvironment[k] === undefined) delete process.env[k]; else process.env[k] = priorEnvironment[k]; } await closePostgresPool(); }
});
async function http(actor = admin, role = 'admin', body?: unknown, action = 'read', aud?: string) {
  const token = await new SignJWT({ id: actor, role, enterpriseId: enterprise }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').setAudience(aud || 'admin').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return mapConfigHttp(new Request('http://localhost:3006/api/platform/map-config', {
    method: body === undefined ? 'GET' : 'PATCH', headers: { cookie: 'auth_token=' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), action);
}
test('settings reject unsupported providers, invalid dates and injected runtime/credential fields', () => {
  assert.equal(validateMapConfigInput(input()).activeProvider, 'amap');
  for (const value of [input({ activeProvider: 'unknown' }), input({ providerKey: 'unknown' }), input({ activeProvider: 'tianditu', signingKey: 'wrong-protocol' }), input({ dailyLimit: 0 }), input({ rights: { ...rights, validUntil: 'tomorrow' } }), { ...input(), providers: { amap: { apiKeyEncrypted: 'injected' } } }, input({ apiKey: 'line\nbreak' })]) assert.throws(() => validateMapConfigInput(value));
});
test('only active platform accounts read or write settings; forged stale role and Mini tokens fail', async () => {
  assert.equal((await mapConfigHttp(new Request('http://localhost/api/platform/map-config'), 'read')).status, 401);
  assert.equal((await http(merchant, 'enterprise_admin')).status, 403);
  assert.equal((await http(designer, 'admin')).status, 403);
  assert.equal((await http(disabled)).status, 403);
  assert.equal((await http(admin, 'admin', undefined, 'read', 'miniprogram')).status, 401);
});
test('explicit environment import encrypts credentials and survives reentry without plaintext or ciphertext DTO fields', async () => {
  const config = await importEnvironmentMapConfig(version, admin); version = config.version;
  assert.equal(config.hasApiKey, true); assert.equal(config.enabled, false);
  const reload = await getPlatformMapConfig(admin); assert.equal(reload.apiKeyMasked, config.apiKeyMasked);
  assert.equal(JSON.stringify(reload).includes(rawKey), false); assert.equal(JSON.stringify(reload).includes('Encrypted'), false);
  const row = await withPlatformTransaction(tx => new PlatformConfigRepository(tx).findByKey('default'));
  assert.equal(JSON.stringify(row!.mapServiceConfig).includes(rawKey), false);
  await assert.rejects(importEnvironmentMapConfig(version, admin), /conflict/);
});
test('save preserves empty credentials, clears optional signature explicitly and serializes stale concurrent edits', async () => {
  const config = await savePlatformMapConfig(input({ signingKey }), admin); version = config.version;
  assert.equal(config.hasSigningKey, true);
  const calls = await Promise.allSettled([savePlatformMapConfig(input({ dailyLimit: 25 }), admin), savePlatformMapConfig(input({ dailyLimit: 50 }), admin)]);
  assert.equal(calls.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls.filter(r => r.status === 'rejected').length, 1);
  version = (await getPlatformMapConfig(admin)).version;
  const cleared = await savePlatformMapConfig(input({ apiKey: '', signingKey: '', clearSigningKey: true, enabled: true }), admin); version = cleared.version;
  assert.equal(cleared.hasSigningKey, false); assert.equal(cleared.available, true);
  assert.equal((await getCommunityRuntimeConfig()).key, rawKey);
});
test('disabling saved configuration takes effect immediately and never falls back to configured environment credentials', async () => {
  process.env.AMAP_COMMERCIAL_LICENSE_CONFIRMED = 'true'; process.env.AMAP_BINDING_RIGHTS_CONFIRMED = 'true'; process.env.AMAP_LICENSE_REFERENCE = rights.reference; process.env.AMAP_RIGHTS_VALID_UNTIL = rights.validUntil;
  const config = await savePlatformMapConfig(input({ enabled: false, rights: { commercialConfirmed: false, bindingConfirmed: false, reference: '', validUntil: '' } }), admin); version = config.version;
  await assert.rejects(getCommunityRuntimeConfig(), /provider_disabled/);
  await assert.rejects(savePlatformMapConfig(input({ enabled: true, clearApiKey: true }), admin), /provider_unconfigured/);
  const current = await getPlatformMapConfig(admin); assert.equal(current.version, version); assert.equal(current.enabled, false);
});
test('saved Key enables search with blank authorization; omitted and expired notes never block runtime or fabricate records', async () => {
  const blank = { commercialConfirmed: false, bindingConfirmed: false, reference: '', validUntil: '' };
  let current = await savePlatformMapConfig(input({ enabled: true, rights: blank }), admin); version = current.version;
  assert.equal(current.available, true); assert.deepEqual(current.rights, blank);
  const runtime = await getCommunityRuntimeConfig(); assert.equal(runtime.key, rawKey); assert.equal(runtime.license, ''); assert.equal(runtime.validUntil, '');
  const expired = { ...blank, reference: 'optional-note-only', validUntil: '2020-01-01T00:00:00Z' };
  current = await savePlatformMapConfig(input({ enabled: true, rights: expired }), admin); version = current.version;
  assert.equal(current.available, true);
  current = await savePlatformMapConfig(input({ enabled: true, rights: undefined }), admin); version = current.version;
  assert.deepEqual(current.rights, expired); assert.equal((await getCommunityRuntimeConfig()).key, rawKey);
  current = await savePlatformMapConfig(input({ rights: blank }), admin); version = current.version;
});
test('saved-key connectivity test works without fabricated rights and persists safe result, not POIs', async () => {
  const result = await testPlatformMapConnection(admin, version, '420500', '花园', async url => {
    const request = new URL(String(url)); assert.equal(request.hostname, 'restapi.amap.com'); assert.equal(request.searchParams.get('key'), rawKey); assert.equal(request.searchParams.get('city'), '420500'); return response();
  });
  assert.equal(result.ok, true); assert.match(result.message, /1 条/);
  assert.equal((await getPlatformMapConfig(admin)).lastTest?.ok, true);
  const row = await withPlatformTransaction(tx => new PlatformConfigRepository(tx).findByKey('default'));
  assert.equal(JSON.stringify(row!.mapServiceConfig).includes(poi.name), false);
  assert.equal((await getPlatformMapConfig(admin)).rights.reference, '');
});
test('failed tests stay counted and raw provider secrets never appear in persistent or returned errors', async () => {
  const result = await testPlatformMapConnection(admin, version, '420500', '花园', async () => { throw Error(rawKey + signingKey); });
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(rawKey), false);
  await testPlatformMapConnection(admin, version, '420500', '花园', async () => response());
  await assert.rejects(testPlatformMapConnection(admin, version, '420500', '花园', async () => { assert.fail('rate-limited test must not call provider'); }), /rate_limited/);
});
test('HTTP saves are bounded and reject unknown fields without altering current configuration', async () => {
  const rejected = await http(admin, 'admin', { ...input(), arbitraryUrl: 'http://private-host' }, 'save'); assert.equal(rejected.status, 422);
  const huge = await http(admin, 'admin', { ...input(), apiKey: 'x'.repeat(9000) }, 'save'); assert.equal(huge.status, 413);
  assert.equal((await getPlatformMapConfig(admin)).version, version);
});
test('authenticated HTTP save returns a persisted masked draft and reentry reads the same revision', async () => {
  const saved = await http(admin, 'admin', input(), 'save'); assert.equal(saved.status, 200);
  const body = await saved.json(); version = body.data.version;
  assert.equal(body.data.hasApiKey, true); assert.equal(JSON.stringify(body).includes(rawKey), false);
  const reload = await http(); assert.equal(reload.status, 200);
  assert.equal((await reload.json()).data.version, version);
});
test('connectivity has an independent daily budget that saving configuration cannot reset', async () => {
  let previous: Record<string, unknown>;
  await withPlatformTransaction(async tx => {
    const repo = new PlatformConfigRepository(tx), row = await repo.ensureForUpdate('default'); previous = row.mapServiceConfig;
    await repo.update('default', { mapServiceConfig: { ...previous, testWindow: { since: 0, count: 0 }, testDay: { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), count: 30 } } });
  });
  const saved = await savePlatformMapConfig(input(), admin); version = saved.version;
  try {
    await assert.rejects(testPlatformMapConnection(admin, version, '420500', '花园', async () => { assert.fail('daily-limited test must not call provider'); }), /daily_limited/);
  } finally {
    await withPlatformTransaction(async tx => {
      const repo = new PlatformConfigRepository(tx), row = await repo.ensureForUpdate('default');
      await repo.update('default', { mapServiceConfig: { ...row.mapServiceConfig, testDay: previous!.testDay || { date: '', count: 0 } } });
    });
  }
});
test('in-flight test cannot overwrite the result of a newer saved configuration', async () => {
  await withPlatformTransaction(async tx => {
    const repo = new PlatformConfigRepository(tx), row = await repo.ensureForUpdate('default');
    await repo.update('default', { mapServiceConfig: { ...row.mapServiceConfig, testWindow: { since: 0, count: 0 } } });
  });
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const pending = testPlatformMapConnection(admin, version, '420500', '花园', async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return response(); });
  await waiting;
  const changed = await savePlatformMapConfig(input({ dailyLimit: 200 }), admin); version = changed.version;
  release(); await assert.rejects(pending, /conflict/);
  assert.equal((await getPlatformMapConfig(admin)).lastTest, null);
});
test('clearing the saved Key never restores it implicitly from the environment', async () => {
  const changed = await savePlatformMapConfig(input({ clearApiKey: true }), admin); version = changed.version;
  assert.equal(changed.hasApiKey, false);
  assert.equal((await getPlatformMapConfig(admin)).hasApiKey, false);
  await assert.rejects(testPlatformMapConnection(admin, version, '420500', '花园', async () => { assert.fail('cleared credential must not reach provider'); }), /unconfigured/);
});
const tdtKey = 'independent-tianditu-fixture-key', tdtRights = { ...rights, reference: 'tianditu-fixture-rights' };
const tdtPoi = { hotPointID: 'TDT_TEST_12345678', name: '测试小区', typeCode: '120201', poiType: 101, city: '宜昌市', cityCode: '156420500', county: '西陵区', countyCode: '156420502', address: '测试路' };
const tdtResponse = () => Response.json({ resultType: 1, status: { infocode: 1000 }, pois: [tdtPoi] });
test('alternate provider configuration, credentials, rights and saved tests stay independent of active provider', async () => {
  let current = await savePlatformMapConfig(input({ apiKey: rawKey, enabled: true }), admin); version = current.version;
  current = await savePlatformMapConfig(input({ activeProvider: 'amap', providerKey: 'tianditu', apiKey: tdtKey, enabled: true,
    rights: { commercialConfirmed: false, bindingConfirmed: false, reference: '', validUntil: '' } }), admin); version = current.version;
  assert.equal(current.activeProvider, 'amap'); assert.equal(current.providerConfigs.tianditu.hasApiKey, true);
  assert.equal(current.providerConfigs.amap.rights.reference, rights.reference); assert.equal(current.providerConfigs.tianditu.rights.reference, '');
  assert.equal((await getCommunityRuntimeConfig()).key, rawKey);
  await withPlatformTransaction(async tx => { const repo = new PlatformConfigRepository(tx), row = await repo.ensureForUpdate('default'); await repo.update('default', { mapServiceConfig: { ...row.mapServiceConfig, testWindow: { since: 0, count: 0 } } }); });
  const tested = await testPlatformMapConnection(admin, version, '420500', '小区', async url => {
    const u = new URL(String(url)); assert.equal(u.hostname, 'api.tianditu.gov.cn'); assert.equal(u.searchParams.get('tk'), tdtKey); return tdtResponse();
  }, 'tianditu');
  assert.equal(tested.ok, true); current = await getPlatformMapConfig(admin);
  assert.equal(current.providerConfigs.tianditu.lastTest?.ok, true); assert.equal(current.lastTest, null);
  assert.equal(JSON.stringify(current).includes(tdtKey), false); assert.equal(JSON.stringify(current).includes(rawKey), false);
  current = await savePlatformMapConfig(input({ activeProvider: 'tianditu', providerKey: 'amap', enabled: true }), admin); version = current.version;
  assert.equal(current.available, true); assert.equal(current.rights.reference, ''); assert.equal((await getCommunityRuntimeConfig()).key, tdtKey);
});
test('explicit provider switch changes runtime immediately and restores original credentials when switched back', async () => {
  let current = await savePlatformMapConfig(input({ providerKey: 'tianditu', enabled: true, rights: tdtRights }), admin); version = current.version;
  current = await savePlatformMapConfig(input({ activeProvider: 'tianditu', providerKey: 'amap', enabled: true }), admin); version = current.version;
  const runtime = await getCommunityRuntimeConfig(); assert.equal(runtime.providerKey, 'tianditu'); assert.equal(runtime.key, tdtKey); assert.equal(runtime.license, tdtRights.reference);
  current = await savePlatformMapConfig(input({ providerKey: 'amap', enabled: true }), admin); version = current.version;
  assert.equal((await getCommunityRuntimeConfig()).key, rawKey); assert.equal(current.providerConfigs.tianditu.hasApiKey, true);
});
test('provider identity and config revision invalidate old selections before provider lookup', async () => {
  const config = { key: rawKey, signingKey: '', license: rights.reference, validUntil: rights.validUntil, dailyLimit: 100, configRevision: 1 };
  const actor = { enterpriseId: enterprise, adminId: admin }, pageKey = randomUUID();
  const first = new PortfolioService(actor, { provider: new AmapCommunityProvider(config, async () => Response.json({ status: '1', pois: [poi] })) });
  const searched = await first.searchProvider({ cityCode: '420500', query: '花园', pageKey });
  const token = (searched.items as Array<{ token: string }>)[0].token;
  const changed = new PortfolioService(actor, { provider: new AmapCommunityProvider({ ...config, configRevision: 2 }, async () => { assert.fail('old configuration must not call provider'); }) });
  await assert.rejects(changed.execute('bindCommunity', { token, pageKey }, randomUUID()), /candidate_changed/);
  const tdt = new PortfolioService(actor, { provider: createCommunityProvider({ ...config, providerKey: 'tianditu' }, async () => { assert.fail('different provider must not call provider'); }) });
  await assert.rejects(tdt.execute('bindCommunity', { token, pageKey }, randomUUID()), /candidate_changed/);
});
test('Tianditu search and signed requery bind once; matching external IDs stay separate from AMap records', async () => {
  await withPlatformTransaction(tx => tx.execute(sql`delete from app.portfolio_provider_usage where enterprise_id=${enterprise}`));
  const config = { key: tdtKey, signingKey: '', license: '', validUntil: '', dailyLimit: 100, providerKey: 'tianditu', configRevision: 1 };
  const tdt = new PortfolioService({ enterpriseId: enterprise, adminId: admin }, { provider: createCommunityProvider(config, async () => Response.json({ resultType: 1, status: { infocode: 1000 }, pois: [{ ...tdtPoi, hotPointID: poi.id }] })) });
  const pageKey = randomUUID(), searched = await tdt.searchProvider({ cityCode: '420500', query: '小区', pageKey });
  const token = (searched.items as Array<{ token: string }>)[0].token, requestKey = randomUUID();
  const community = await tdt.execute('bindCommunity', { token, pageKey }, requestKey); assert.equal(community.provider, 'tianditu');
  const stored = await withPlatformTransaction(tx => one(tx, sql`select provenance,license_valid_until from app.portfolio_communities where enterprise_id=${enterprise} and id=${String(community.id)}`));
  assert.equal(stored!.provenance, ''); assert.equal(stored!.license_valid_until, null);
  const listed = await tdt.execute('communities', { cityCode: '420500' }); assert.ok((listed.items as Array<Record<string, unknown>>).some(row => String(row.id) === String(community.id)));
  assert.deepEqual(await tdt.execute('bindCommunity', { token, pageKey }, requestKey), community);
  await withPlatformTransaction(tx => tx.execute(sql`update app.portfolio_provider_usage set created_at=now()-interval '2 seconds' where enterprise_id=${enterprise}`));
  const amap = new PortfolioService({ enterpriseId: enterprise, adminId: admin }, { provider: new AmapCommunityProvider({ ...config, key: rawKey, providerKey: 'amap' }, async () => Response.json({ status: '1', pois: [poi] })) });
  const other = await amap.searchProvider({ cityCode: '420500', query: '花园', pageKey });
  const amapCommunity = await amap.execute('bindCommunity', { token: (other.items as Array<{ token: string }>)[0].token, pageKey }, randomUUID());
  assert.equal(amapCommunity.provider, 'amap'); assert.notEqual(String(amapCommunity.id), String(community.id));
});
test('provider cooldown/day budgets are isolated while short-window caps remain shared across providers', async () => {
  await withPlatformTransaction(async tx => {
    await tx.execute(sql`delete from app.portfolio_provider_usage where enterprise_id=${enterprise}`);
    await tx.execute(sql`insert into app.portfolio_provider_usage(enterprise_id,actor_id,page_key,provider_key,created_at,blocked_until) values(${enterprise},${admin},'map-budget-test','amap',now()-interval '2 seconds',now()+interval '1 minute')`);
    const reserve = async (provider: string, cap = 100) => Boolean((await one(tx, sql`select app.portfolio_reserve_provider(${admin}::bigint,${enterprise}::bigint,'map-budget-test',${cap},${provider}) as ok`))!.ok);
    assert.equal(await reserve('amap'), false); assert.equal(await reserve('tianditu'), true);
    assert.equal(await reserve('tianditu', 1), false); assert.equal(await reserve('unknown'), false);
    assert.equal(await reserve('tianditu'), true); assert.equal(await reserve('tianditu'), true); assert.equal(await reserve('tianditu'), false);
  });
});
