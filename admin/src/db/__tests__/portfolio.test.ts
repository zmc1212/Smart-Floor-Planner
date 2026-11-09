import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { PortfolioService } from '@/lib/portfolio/service';
import { AmapCommunityProvider } from '@/lib/portfolio/community-provider';
import { DELETE, GET, POST, PUT } from '@/app/api/portfolio/[[...path]]/route';
import { GET as platformTemplatesGET, PATCH as platformTemplatesPATCH } from '@/app/api/platform/portfolio-templates/[[...path]]/route';
import { listPlatformTemplates, platformTemplateDetail, setPlatformTemplateStatus } from '@/lib/portfolio/platform-templates';
import type { WorkContent } from '@/lib/portfolio/contracts';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { readPortfolioEntry } from '@/lib/portfolio/entry';
import { LocationService } from '@/lib/assistant/location/service';
import { decodeJwt } from 'jose';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { projectMessage } from '@/lib/assistant/knowledge/sources';

const prefix = 'portfolio-' + randomUUID(), tenants: string[] = [], staff: string[][] = [], services: PortfolioService[][] = [];
const users: string[] = [], customers: ActorContext[] = [], conversations: string[] = [];
let imageBase64: string, workId: string, assetId: string;
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!; tenants.push(String(e.id)); staff.push([]); services.push([]);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${tenants[i]},true,100,1200000,100000000,30)`);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!; users.push(String(u.id));
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${users[i]},${prefix + i})`);
      customers.push({ enterpriseId: tenants[i], principal: { kind: 'user', userId: users[i] }, contextVersion: 1, capabilities: ['assistant.chat.self'] });
      for (let j = 0; j < 4; j++) {
        const role = j === 0 ? 'enterprise_admin' : j === 3 ? 'measurer' : 'designer';
        const a = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name) values(${tenants[i]},${prefix + i + j},'test-only',${role},'active',false,${'测试员工' + j}) returning id`))!;
        staff[i].push(String(a.id)); services[i].push(new PortfolioService({ enterpriseId: tenants[i], adminId: String(a.id) }));
      }
    }
  });
  for (const customer of customers) conversations.push(String((await new ConversationService(customer).create(randomUUID())).id));
  imageBase64 = (await sharp({ create: { width: 400, height: 300, channels: 3, background: '#d8dfd5' } }).withMetadata({ exif: { IFD0: { Artist: 'private-owner' } } }).png().toBuffer()).toString('base64');
});
after(async () => {
  try { await withPlatformTransaction(async tx => { await tx.execute(sql`delete from app.platform_portfolio_templates where key like ${prefix + '%'}`); for (const eid of tenants) { await deletePortfolioData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); } for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`); }); }
  finally { await closePostgresPool(); }
});
type TestResult = Row & { head: Row & { content: WorkContent }; work: Row; versions: Array<Row & { content: WorkContent }>; items: Row[]; assets: Row[]; template: Row & { content: WorkContent }; images: Row[] };
const exec = async (action: string, input: Row = {}, operator = 1, tenant = 0, key = randomUUID()) => await services[tenant][operator].execute(action, input, key) as TestResult;
const contents = () => ({ title: '原木测试作品', description: '客餐厅收纳与动线参考', primaryStyle: '原木风', secondaryStyles: ['现代简约'], cityCode: '330100', cityName: '杭州市', district: '西湖区', authorRole: '主创设计', source: '隔离回归自制图片，不是实际客户案例', authorization: '测试作者授权全部图片展示与推荐', images: [{ assetId, kind: 'render', aiGenerated: true, showroom: false, caption: '测试效果图' }], coverAssetId: assetId });
test('real drafts/uploads survive reentry; concurrent idempotency creates once; other authors and tenants cannot access', async () => {
  const key = randomUUID(), body = { content: { title: '草稿' } };
  const [a, b] = await Promise.all([exec('create', body, 1, 0, key), exec('create', body, 1, 0, key)]); assert.deepEqual(a, b); workId = String(a.id);
  await assert.rejects(exec('create', { authorId: staff[0][2] }), /forbidden/);
  await assert.rejects(exec('create', {}, 3), /forbidden/);
  await assert.rejects(exec('detail', { workId }, 2), /not_found/); await assert.rejects(exec('detail', { workId }, 0, 1), /not_found/);
  const upload = await exec('upload', { workId, expectedVersion: 1, imageBase64 }); assetId = String(upload.assetId);
  const duplicate = await exec('upload', { workId, expectedVersion: 1, imageBase64 }); assert.equal(duplicate.assetId, assetId);
  const bytes = Buffer.from(String((await exec('asset', { workId, assetId })).image_base64), 'base64');
  assert.ok(bytes.length <= 300 * 1024); assert.equal(bytes[0], 255); assert.equal(bytes[1], 216); assert.equal((await sharp(bytes).metadata()).exif, undefined);
  await assert.rejects(exec('asset', { workId, assetId }, 2), /not_found/);
  const saved = await exec('save', { workId, expectedVersion: 1, content: contents() }); assert.equal(saved.version, 2);
  const detail = await exec('detail', { workId }); assert.equal(detail.head.content.title, '原木测试作品');
  await assert.rejects(exec('submit', { workId, expectedVersion: 1 }), /version_conflict/);
});
test('return/publish/new draft keeps old publication immutable; stale mutations and designer publishing are rejected', async () => {
  await exec('submit', { workId, expectedVersion: 2 });
  await assert.rejects(exec('save', { workId, expectedVersion: 3, content: contents() }), /draft_required/);
  await assert.rejects(exec('publish', { workId, expectedVersion: 3 }), /forbidden/);
  await exec('return', { workId, expectedVersion: 3, note: '请核对作者许可' }, 0);
  assert.equal((await exec('detail', { workId })).head.review_note, '请核对作者许可');
  await exec('save', { workId, expectedVersion: 4, content: contents() }); await exec('submit', { workId, expectedVersion: 5 }); await exec('publish', { workId, expectedVersion: 6 }, 0);
  const first = (await exec('detail', { workId })).work.published_version_id;
  await exec('newDraft', { workId, expectedVersion: 7 }); await exec('save', { workId, expectedVersion: 8, content: { ...contents(), title: '新版本' } });
  const d = await exec('detail', { workId }); assert.equal(d.work.published_version_id, first); assert.notEqual(d.work.head_version_id, first);
  const firstVersion = d.versions.find(v => String(v.id) === String(first)); assert.ok(firstVersion); assert.equal(firstVersion.content.title, '原木测试作品');
  await assert.rejects(withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.portfolio_versions set content='{}' where enterprise_id=${tenants[0]} and id=${String(first)}`)), (e: unknown) => /immutable/.test(String((e as Error & { cause?: Error }).cause?.message)));
  await exec('submit', { workId, expectedVersion: 9 }); await exec('publish', { workId, expectedVersion: 10 }, 0);
  const next = (await exec('detail', { workId })).work.published_version_id; assert.notEqual(next, first);
  await exec('withdraw', { workId, expectedVersion: 11 }, 0); assert.equal((await exec('detail', { workId })).work.withdrawn, true);
});
test('references retain their source and cannot become original portfolio work; no legacy knowledge is silently migrated', async () => {
  const created = await exec('create', { kind: 'enterprise_reference', content: { showOnProfile: false } }, 0);
  const wid = String(created.id), img = await exec('upload', { workId: wid, expectedVersion: 1, imageBase64 }, 0);
  const content = { ...contents(), images: [{ assetId: String(img.assetId), kind: 'photo', aiGenerated: false, showroom: true, caption: '' }], coverAssetId: String(img.assetId), showOnProfile: true };
  await exec('save', { workId: wid, expectedVersion: 1, content }, 0); await assert.rejects(exec('submit', { workId: wid, expectedVersion: 2 }, 0), /not_original/);
  await exec('save', { workId: wid, expectedVersion: 2, content: { ...content, showOnProfile: false } }, 0); await exec('submit', { workId: wid, expectedVersion: 3 }, 0); await exec('publish', { workId: wid, expectedVersion: 4 }, 0);
  assert.equal((await exec('detail', { workId: wid }, 0)).work.author_id, null);
  assert.equal((await exec('list')).items.some((w: Row) => w.id === wid), false);
  const count = await withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.assistant_knowledge_documents where enterprise_id=${tenants[0]}`)); assert.equal(Number(count!.n), 0);
});
test('profile scope and staff deactivation are rechecked without changing professional identity', async () => {
  const data = { bio: '本人设计自述', cities: [{ code: '330100', name: '杭州市', districts: ['西湖区'] }], styles: ['原木风'], layoutSpecialties: ['三居'], featuredWorkIds: [workId] };
  const competing = await Promise.allSettled([exec('saveProfile', { authorId: staff[0][1], expectedVersion: 0, content: data }), exec('saveProfile', { authorId: staff[0][1], expectedVersion: 0, content: data })]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1); assert.equal(competing.filter(r => r.status === 'rejected').length, 1);
  assert.deepEqual((await exec('profile', { authorId: staff[0][1] })).content, { ...data, template: 'gallery' });
  const version = Number((await exec('profile', { authorId: staff[0][1] })).version);
  const selected = { ...data, template: 'notebook', defaultAvatar: 'male' };
  await exec('saveProfile', { authorId: staff[0][1], expectedVersion: version, content: selected });
  assert.deepEqual((await exec('profile', { authorId: staff[0][1] })).content, selected);
  await exec('saveProfile', { authorId: staff[0][1], expectedVersion: version + 1, content: data });
  assert.deepEqual((await exec('profile', { authorId: staff[0][1] })).content, selected);
  await assert.rejects(exec('saveProfile', { authorId: staff[0][1], expectedVersion: version + 2, content: { ...data, template: 'unknown' } }), /invalid_portfolio/);
  await assert.rejects(exec('saveProfile', { authorId: staff[0][1], expectedVersion: version + 2, content: { ...data, defaultAvatar: 'https://example.invalid/avatar' } }), /invalid_portfolio/);
  assert.equal((await exec('profile', { authorId: staff[0][1] })).version, version + 2);
  await assert.rejects(exec('saveProfile', { authorId: staff[0][2], expectedVersion: 0, content: data }), /forbidden/);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${staff[0][1]}`));
  try { await assert.rejects(exec('detail', { workId }), /forbidden/); } finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${staff[0][1]}`)); }
});
test('manual community verification has stable IDs, no same-name merge and tenant/city validation', async () => {
  const content = { cityCode: '330100', cityName: '杭州市', name: '同名花园一期', district: '西湖区', address: '隔离测试公开地址' };
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const request = await exec('requestCommunity', { content }); await assert.rejects(exec('reviewCommunity', { requestId: String(request.id), approve: true, note: '企业自有核验名录' }), /forbidden/);
    const approved = await exec('reviewCommunity', { requestId: String(request.id), approve: true, note: '企业自有核验名录，仅测试' }, 0); ids.push(String(approved.community_id));
  }
  assert.notEqual(ids[0], ids[1]);
  assert.equal((await exec('communities', { cityCode: '330100', query: '同名' })).items.length, 2);
  assert.equal((await exec('communities', { cityCode: '330100' }, 0, 1)).items.length, 0);
  const own = await exec('create'); await assert.rejects(exec('save', { workId: String(own.id), expectedVersion: 1, content: { communityId: ids[0], cityCode: '330200' } }), /candidate_invalid/);
});
test('mocked AMap search/bind exercises actual DB rate budget, signed selection and persistence without paid network calls', async () => {
  const raw = { id: 'B0FFTEST001', name: '模拟小区二期', typecode: '120302', adcode: '330106', cityname: '杭州市', adname: '西湖区', address: '测试路' };
  let calls = 0;
  const provider = new AmapCommunityProvider({ key: 'test-only', signingKey: '', license: '隔离模拟许可', validUntil: '2099-01-01', dailyLimit: 1000 }, async () => { calls++; return Response.json({ status: '1', pois: [raw] }); });
  const service = new PortfolioService({ enterpriseId: tenants[0], adminId: staff[0][1] }, { provider });
  const search = await service.searchProvider({ cityCode: '330100', query: '模拟', pageKey: 'test-page-one' }); const candidates = search.items as Row[]; assert.equal(candidates.length, 1);
  const key = randomUUID(), input = { token: candidates[0].token, pageKey: 'test-page-one' };
  const bound = await service.execute('bindCommunity', input, key); const same = await service.execute('bindCommunity', input, key); assert.equal(bound.id, same.id); assert.equal(calls, 2);
  assert.equal((await exec('communities', { cityCode: '330100', query: '模拟' })).items[0].id, bound.id);
  const foreign = new PortfolioService({ enterpriseId: tenants[1], adminId: staff[1][1] }, { provider });
  await assert.rejects(foreign.execute('bindCommunity', input, randomUUID()), /candidate_invalid/); assert.equal(calls, 2);
  const cap = await withTenantTransaction(tenants[0], tx => one(tx, sql`select app.portfolio_reserve_provider(${staff[0][1]}::bigint,${tenants[0]}::bigint,'test-page-one',1) as allowed`)); assert.equal(cap!.allowed, false);
  const usage = await withTenantTransaction(tenants[0], tx => rows(tx, sql`select * from app.portfolio_provider_usage where enterprise_id=${tenants[0]}`)); assert.equal(usage.length, 2); assert.ok(!JSON.stringify(usage).includes('模拟'));
});
test('failed provider attempts stay counted and pause subsequent external calls', async () => {
  let calls = 0;
  const provider = new AmapCommunityProvider({ key: 'test-only', signingKey: '', license: 'mock-only', validUntil: '2099-01-01', dailyLimit: 1000 }, async () => { calls++; throw Error('mock network failure'); });
  const service = new PortfolioService({ enterpriseId: tenants[0], adminId: staff[0][2] }, { provider });
  const query = { cityCode: '330100', query: '失败回归', pageKey: 'provider-failure-page' };
  await assert.rejects(service.searchProvider(query), /provider_unavailable/);
  await assert.rejects(service.searchProvider(query), /rate_limited/); assert.equal(calls, 1);
  const usage = await withTenantTransaction(tenants[0], tx => one(tx, sql`select failure_code,blocked_until from app.portfolio_provider_usage where enterprise_id=${tenants[0]} and actor_id=${staff[0][2]} order by id desc limit 1`));
  assert.equal(usage!.failure_code, 'community_provider_unavailable'); assert.ok(new Date(String(usage!.blocked_until)).getTime() > Date.now());
});
test('HTTP route rechecks actual identity, rejects body injection and returns private JPEGs', async () => {
  const token = await new SignJWT({ id: staff[0][1], username: prefix, role: 'designer', enterpriseId: tenants[0], permissions: ['case-publishing'], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff[0][1]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const headers = { cookie: 'auth_token=' + token };
  const detail = await GET(new NextRequest('http://localhost:3006/api/portfolio/works/' + workId, { headers }), { params: Promise.resolve({ path: ['works', workId] }) }); assert.equal(detail.status, 200);
  const asset = await GET(new NextRequest(`http://localhost:3006/api/portfolio/works/${workId}/assets/${assetId}`, { headers }), { params: Promise.resolve({ path: ['works', workId, 'assets', assetId] }) }); assert.equal(asset.status, 200); assert.equal(asset.headers.get('content-type'), 'image/jpeg'); assert.match(asset.headers.get('cache-control')!, /no-store/);
  const denied = await POST(new NextRequest('http://localhost:3006/api/portfolio/works', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ enterpriseId: tenants[1] }) }), { params: Promise.resolve({ path: ['works'] }) }); assert.equal(denied.status, 422);
  const rls = await withTenantTransaction(tenants[1], tx => rows(tx, sql`select id from app.portfolio_works where id=${workId}`)); assert.equal(rls.length, 0);
});
test('P2C.2 public read model exposes approved images only; matching deduplicates authors and never treats reference works as originals', async () => {
  await exec('newDraft', { workId, expectedVersion: 12 });
  await exec('save', { workId, expectedVersion: 13, content: { ...contents(), rightsUntil: new Date(Date.now() + 3600000).toISOString() } });
  await exec('submit', { workId, expectedVersion: 14 }); await exec('publish', { workId, expectedVersion: 15 }, 0);
  const catalog = new PortfolioCatalog(customers[0], conversations[0]);
  const result = await catalog.recommend({ cityCode: '330100', style: '原木风' }); assert.equal(result.items.length, 1); assert.equal(result.items[0].match, 'city_style');
  const work = result.items[0].work; assert.equal(work.authorId, staff[0][1]);
  assert.ok(!JSON.stringify(work).includes('authorization')); assert.ok(!JSON.stringify(work).includes('隔离回归自制图片')); assert.ok(!JSON.stringify(work).includes('image_base64'));
  assert.equal((await catalog.designer(staff[0][1])).works.length, 1);
  assert.ok((await catalog.image(workId, work.versionId, assetId)).length > 0);
  await assert.rejects(catalog.image(workId, '1', assetId), /not_found/);
  await assert.rejects(catalog.recommend({ cityCode: '330100', style: '不存在风格' }), /invalid_portfolio/);
  await assert.rejects(new PortfolioCatalog(customers[1], conversations[0]).work(workId), /resource_not_found/);
  await assert.rejects(new PortfolioCatalog({ ...customers[0], contextVersion: 99 }, conversations[0]).work(workId), /identity_context_invalid/);
  const now = Date.now; Date.now = () => now() + 7200000;
  try {
    await assert.rejects(catalog.work(workId, work.versionId), /not_found/);
    assert.equal((await catalog.recommend({ cityCode: '330100', style: '原木风' })).items.length, 0);
    await assert.rejects(catalog.designer(staff[0][1]), /portfolio_not_found/);
    await assert.rejects(catalog.image(workId, work.versionId, assetId), /not_found/);
    await assert.rejects(catalog.share(workId, work.versionId), /not_found/);
    await assert.rejects(catalog.contact(workId, { versionId: work.versionId }, randomUUID()), /not_found/);
  } finally { Date.now = now; }
});
test('P2C.2 same-community style wins over city fallback and multiple works never duplicate the designer', async () => {
  const communityId = String((await exec('communities', { cityCode: '330100', query: '同名' })).items[0].id);
  for (const operator of [1, 2]) {
    const created = await exec('create', {}, operator), wid = String(created.id), img = await exec('upload', { workId: wid, expectedVersion: 1, imageBase64 }, operator);
    const content = { ...contents(), communityId, images: [{ assetId: String(img.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '' }], coverAssetId: String(img.assetId) };
    await exec('save', { workId: wid, expectedVersion: 1, content }, operator); await exec('submit', { workId: wid, expectedVersion: 2 }, operator); await exec('publish', { workId: wid, expectedVersion: 3 }, 0);
    if (operator === 2) await exec('saveProfile', { authorId: staff[0][2], expectedVersion: 0, content: { bio: '测试', cities: [{ code: '330100', name: '杭州市', districts: [] }], styles: ['原木风'], featuredWorkIds: [] } }, operator);
  }
  const result = await new PortfolioCatalog(customers[0], conversations[0]).recommend({ cityCode: '330100', style: '原木风', communityId });
  assert.equal(result.items.length, 2); assert.equal(new Set(result.items.map(i => i.authorId)).size, 2); assert.ok(result.items.every(i => i.match === 'community_style'));
});
test('optional map authorization never hides bound communities, draft selections or same-community public recommendations', async () => {
  const communityId = String((await exec('communities', { cityCode: '330100', query: '同名' })).items[0].id);
  const original = await withTenantTransaction(tenants[0], tx => one(tx, sql`select provider,provider_poi_id,license_valid_until from app.portfolio_communities where enterprise_id=${tenants[0]} and id=${communityId}`));
  const catalog = new PortfolioCatalog(customers[0], conversations[0]);
  try {
    for (const recordedExpiry of [null, '2020-01-01T00:00:00Z']) {
      await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.portfolio_communities set provider='amap',provider_poi_id=${'optional-' + communityId},license_valid_until=${recordedExpiry}::timestamptz where enterprise_id=${tenants[0]} and id=${communityId}`));
      const listed = await exec('communities', { cityCode: '330100', communityId });
      assert.ok(listed.items.some((item: Row) => String(item.id) === communityId));
      const draft = await exec('create', {}, 1);
      await exec('save', { workId: String(draft.id), expectedVersion: 1, content: { communityId, cityCode: '330100' } }, 1);
      const result = await catalog.recommend({ cityCode: '330100', style: '原木风', communityId });
      assert.equal(result.items.length, 2); assert.ok(result.items.every(item => item.match === 'community_style' && item.work.community?.id === communityId));
      await assert.rejects(new PortfolioCatalog(customers[1], conversations[1]).recommend({ cityCode: '330100', style: '原木风', communityId }), /candidate_invalid/);
    }
  } finally {
    await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.portfolio_communities set provider=${String(original!.provider)},provider_poi_id=${original!.provider_poi_id},license_valid_until=${original!.license_valid_until} where enterprise_id=${tenants[0]} and id=${communityId}`));
  }
});
test('P2C.2 automatic recommendations require unambiguous current city/style and never guess from a negative preference', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]);
  assert.equal((await catalog.recommend()).needContext, true);
  const setFacts = (housing: string, style: string) => withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify({ version: 1, facts: [{ field: 'housing', value: housing, status: 'current' }, { field: 'style', value: style, status: 'current' }] })}::jsonb)
    where enterprise_id=${tenants[0]} and id=${conversations[0]}`));
  await setFacts('房子在杭州', '原木风'); assert.equal((await catalog.recommend()).items.length, 2);
  await setFacts('房子不在杭州', '原木风'); assert.equal((await catalog.recommend()).needContext, true);
  await setFacts('杭州或宁波，还没确定', '原木风'); assert.equal((await catalog.recommend()).needContext, true);
  await setFacts('房子在杭州', '不喜欢原木风'); assert.equal((await catalog.recommend()).needContext, true);
});

test('location-backed recommendations persist without spoken city, keep coordinates ephemeral and enforce owner/tenant/revocation', async () => {
  const created = await new ConversationService(customers[0]).create(randomUUID()), cid = String(created.id);
  let lookups = 0;
  const dependencies = { config: async () => ({ key: 'synthetic', signingKey: '', license: '', validUntil: '', dailyLimit: 100 }),
    resolve: async () => { lookups++; return { cityCode: '330100', cityName: '杭州市', district: '西湖区', source: 'wechat_location' as const, resolvedAt: new Date().toISOString() }; } };
  const location = new LocationService(customers[0], cid, dependencies), point = { latitude: 30.25, longitude: 120.13, coordinateSystem: 'gcj02' };
  assert.equal((await new PortfolioCatalog(customers[0], cid).recommend()).needContext, true);
  await location.locate(point);
  assert.equal((await new LocationService(customers[0], cid).read()).region?.cityCode, '330100');
  const result = await new PortfolioCatalog(customers[0], cid).recommend(); assert.ok(result.items.length > 0); assert.ok(result.items.every(i => i.work.cityCode === '330100'));
  const stored = await withTenantTransaction(tenants[0], tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${tenants[0]} and id=${cid}`));
  assert.doesNotMatch(JSON.stringify(stored), /latitude|longitude|30\.25|120\.13|gcj02/);
  await assert.rejects(new LocationService(customers[1], cid, dependencies).locate(point));
  const other = { ...customers[0], principal: { kind: 'user' as const, userId: users[1] } };
  await assert.rejects(new LocationService(other, cid, dependencies).locate(point)); assert.equal(lookups, 1);
  await location.locate(point); await location.locate(point); await assert.rejects(location.locate(point), /location_rate_limited/); assert.equal(lookups, 3);
  await location.clear(); await location.clear(); assert.equal((await location.read()).region, null);
  assert.equal((await new PortfolioCatalog(customers[0], cid).recommend()).needContext, true);
});

test('P2C.2 explicit preferences persist once, retain correction lineage and reject stale versions/other customers', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]), work = await catalog.work(workId), key = randomUUID();
  const body = { versionId: work.versionId, sentiment: 'like', expectedVersion: 0 };
  const [a, b] = await Promise.all([catalog.preference(workId, body, key), catalog.preference(workId, body, key)]); assert.deepEqual(a, b);
  assert.equal((await catalog.work(workId)).preference, 'like'); assert.equal((await catalog.work(workId)).preferenceVersion, 1);
  await assert.rejects(catalog.preference(workId, { ...body, sentiment: 'dislike' }, randomUUID()), /version_conflict/);
  await catalog.preference(workId, { ...body, sentiment: 'dislike', expectedVersion: 1 }, randomUUID());
  assert.equal((await new PortfolioCatalog(customers[0], conversations[0]).work(workId)).preference, 'dislike');
  const stored = await withTenantTransaction(tenants[0], tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where id=${conversations[0]} and enterprise_id=${tenants[0]}`));
  const prefs = (stored!.entry_snapshot as Row).portfolioPreferences as Row[];
  assert.equal(prefs.length, 2); assert.equal(prefs[1].supersedes, prefs[0].operationId); assert.ok(prefs[0].sourceMessageId);
  await assert.rejects(new PortfolioCatalog(customers[1], conversations[0]).preference(workId, body, randomUUID()), /resource_not_found/);
  await assert.rejects(catalog.preference(workId, { ...body, versionId: '1' }, randomUUID()), /not_found/);
});

test('P2C.2 signed studio sharing creates the recipient own consultation and rechecks current publication', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]), work = await catalog.work(workId);
  const share = await catalog.share(workId, work.versionId), decoded = decodeJwt(share.token);
  assert.equal(decoded.workId, workId); assert.equal(decoded.conversationId, undefined); assert.equal(decoded.userId, undefined); assert.equal(decoded.channelCode, undefined);
  assert.equal((await readPortfolioEntry(share.token)).enterpriseId, tenants[0]);
  await assert.rejects(readPortfolioEntry(share.token.slice(0, -8) + 'tampered'), /entry_context_invalid/);
  const mini = await signMiniProgramToken({ sub: users[1], id: users[1], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const post = (path: string[], body: Row, k = randomUUID()) => assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + path.join('/'), {
    method: 'POST', headers: { authorization: 'Bearer ' + mini, 'Content-Type': 'application/json', 'Idempotency-Key': k }, body: JSON.stringify(body) }), path);
  const entryResponse = await post(['entry-context'], { portfolioEntry: share.token }); assert.equal(entryResponse.status, 200);
  const entry = (await entryResponse.json()).data; assert.equal(entry.portfolio.authorId, staff[0][1]);
  const created = await post(['conversations'], { entryToken: entry.entryToken }); assert.equal(created.status, 200);
  const cid = (await created.json()).data.id; assert.notEqual(cid, conversations[0]);
  const own = await assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/conversations/' + cid + '/portfolio/designers/' + staff[0][1], { headers: { authorization: 'Bearer ' + mini } }), ['conversations', cid, 'portfolio', 'designers', staff[0][1]]);
  assert.equal(own.status, 200);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${staff[0][1]}`));
  try { assert.equal((await post(['entry-context'], { portfolioEntry: share.token })).status, 404); await assert.rejects(catalog.share(workId, work.versionId), /not_found/); }
  finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${staff[0][1]}`)); }
});

test('P2C.2 HTTP preference/image/contact return real persisted feedback without creating leads or phone consent', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]), work = await catalog.work(workId);
  const mini = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const path = ['conversations', conversations[0], 'portfolio', 'works', workId];
  const request = (tail: string[], method = 'GET', body?: Row, key = randomUUID(), query = '') => assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + [...path, ...tail].join('/') + query, {
    method, headers: { authorization: 'Bearer ' + mini, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body ? { body: JSON.stringify(body) } : {}) }), [...path, ...tail]);
  const image = await request(['assets', assetId], 'GET', undefined, randomUUID(), '?versionId=' + work.versionId + '&format=base64');
  assert.equal(image.status, 200); assert.match((await image.json()).data.imageBase64, /^\/9j\//);
  const pref = await request(['preference'], 'POST', { versionId: work.versionId, sentiment: 'like', expectedVersion: 2 }); assert.equal(pref.status, 200);
  const counts = () => withTenantTransaction(tenants[0], tx => one(tx, sql`select count(*) n from app.leads where enterprise_id=${tenants[0]}`));
  const beforeCount = Number((await counts())!.n), key = randomUUID();
  const contact = await request(['contact'], 'POST', { versionId: work.versionId }, key); assert.equal(contact.status, 200);
  assert.equal((await request(['contact'], 'POST', { versionId: work.versionId }, key)).status, 200);
  const state = await new HandoffService(customers[0]).customerRead(conversations[0]);
  const handoff = state.handoff as Row; assert.equal(handoff.recipientId, staff[0][1]); assert.equal(handoff.contactConsent, false); assert.equal(handoff.phone, '');
  assert.deepEqual((handoff.source as Row).portfolio, { workId, versionId: work.versionId, authorId: staff[0][1] });
  assert.equal(state.mode, 'handoff_requested'); assert.equal(Number((await counts())!.n), beforeCount);
  await new HandoffService(customers[0]).customerWrite(conversations[0], randomUUID(), { action: 'cancel' });
});

test('P2C.2 contact retains the current service owner and requires authorized coordination for a conflict', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]), work = await catalog.work(workId);
  const prior = await withTenantTransaction(tenants[0], tx => one(tx, sql`select entry_snapshot from app.assistant_conversations where enterprise_id=${tenants[0]} and id=${conversations[0]}`));
  await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${JSON.stringify({ state: 'ended', ownerId: staff[0][2] })}::jsonb) where enterprise_id=${tenants[0]} and id=${conversations[0]}`));
  try { await assert.rejects(catalog.contact(workId, { versionId: work.versionId }, randomUUID()), /portfolio_owner_conflict/); }
  finally { await withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_conversations set entry_snapshot=${JSON.stringify(prior!.entry_snapshot)}::jsonb where enterprise_id=${tenants[0]} and id=${conversations[0]}`)); }
});

test('portrait requires author consent; managers remove but never upload; public reads return JPEG bytes without consent metadata', async () => {
  const png = (await sharp({ create: { width: 640, height: 480, channels: 3, background: '#cfe8d8' } }).png().toBuffer()).toString('base64');
  await assert.rejects(exec('savePortrait', { authorId: staff[0][1], imageBase64: png }), /invalid_portfolio/);
  await exec('savePortrait', { authorId: staff[0][1], imageBase64: png, consent: true }, 1);
  await assert.rejects(exec('savePortrait', { authorId: staff[0][1], imageBase64: png, consent: true }, 0), /forbidden/);
  const stored = await withTenantTransaction(tenants[0], tx => one(tx, sql`select length(image_base64) n,consent_by,content_hash from app.portfolio_portraits where enterprise_id=${tenants[0]} and author_id=${staff[0][1]}`));
  assert.ok(Number(stored!.n) <= 409600); assert.equal(String(stored!.consent_by), staff[0][1]); assert.ok(String(stored!.content_hash).length >= 32);
  await assert.rejects(exec('portrait', { authorId: staff[0][1] }, 0, 1), /portfolio_author_unavailable/);
  const authors = await exec('authors', {}, 0);
  const me = authors.items.find((item: Row) => String(item.id) === staff[0][1])!;
  assert.equal(me.portrait_available, true); assert.ok(!JSON.stringify(me).includes('consent')); assert.ok(!('image_base64' in me));
  const bytes = await new PortfolioCatalog(customers[0], conversations[0]).portrait(staff[0][1]);
  const meta = await sharp(bytes).metadata(); assert.equal(meta.width, 512); assert.equal(meta.height, 512); assert.equal(meta.format, 'jpeg');
  const token = await new SignJWT({ id: staff[0][1], username: prefix, role: 'designer', enterpriseId: tenants[0], permissions: ['case-publishing'], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff[0][1]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const path = ['profiles', staff[0][1], 'portrait'];
  const raw = await GET(new NextRequest('http://localhost:3006/api/portfolio/' + path.join('/'), { headers: { cookie: 'auth_token=' + token } }), { params: Promise.resolve({ path }) });
  assert.equal(raw.status, 200); assert.equal(raw.headers.get('content-type'), 'image/jpeg'); assert.equal(raw.headers.get('x-content-type-options'), 'nosniff'); assert.match(raw.headers.get('cache-control')!, /no-store/);
  const mini = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const miniPath = ['conversations', conversations[0], 'portfolio', 'designers', staff[0][1], 'portrait'];
  const publicRead = await assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + miniPath.join('/') + '?format=base64', { headers: { authorization: 'Bearer ' + mini } }), miniPath);
  assert.equal(publicRead.status, 200); assert.match((await publicRead.json()).data.imageBase64, /^\/9j\//);
  const removed = await DELETE(new NextRequest('http://localhost:3006/api/portfolio/' + path.join('/'), { method: 'DELETE', headers: { cookie: 'auth_token=' + token, 'Idempotency-Key': randomUUID() } }), { params: Promise.resolve({ path }) });
  assert.equal(removed.status, 200);
  await assert.rejects(exec('portrait', { authorId: staff[0][1] }), /portfolio_not_found/);
  await assert.rejects(new PortfolioCatalog(customers[0], conversations[0]).portrait(staff[0][1]), /portfolio_not_found/);
});

test('P2C.2 conversation-bound HTTP survives reentry and invalidates old image reads on withdrawal or staff deactivation', async () => {
  const catalog = new PortfolioCatalog(customers[0], conversations[0]), work = await catalog.work(workId);
  const mini = await signMiniProgramToken({ sub: users[0], id: users[0], contextVersion: 1, mode: 'customer', role: 'user', source: 'wechat' });
  const path = ['conversations', conversations[0], 'portfolio', 'works', workId, 'assets', assetId];
  const request = () => new Request('http://localhost:3006/api/miniprogram/assistant/' + path.join('/') + '?versionId=' + work.versionId, { headers: { authorization: 'Bearer ' + mini } });
  assert.equal((await assistantHttp(request(), path)).status, 200); assert.equal((await assistantHttp(request(), path)).status, 200);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${staff[0][1]}`));
  try { assert.equal((await assistantHttp(request(), path)).status, 404); } finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${staff[0][1]}`)); }
  await exec('withdraw', { workId, expectedVersion: 16 }, 0); assert.equal((await assistantHttp(request(), path)).status, 404);
});

test('template library lists enterprise samples, instantiates designer drafts with copied assets and enforces author/tenant boundaries', async () => {
  const content = { title: '测试样本 · 96㎡奶油风三居', description: '隔离回归用示例方案。', primaryStyle: '奶油风', secondaryStyles: [], cityCode: '420500', cityName: '宜昌市', district: '西陵区', communityId: null, area: 96, rooms: '三房两厅', layoutTypes: ['三居'], authorRole: '', source: 'template_library', authorization: '', rightsUntil: null, highlights: ['回归用亮点'], materials: ['乳胶漆'], palette: [{ name: '奶油白', hex: '#F5F0E6' }], tours: [], showOnProfile: true, recommendable: true };
  const spaces = ['客厅', '餐厅', '主卧', '儿童房', '厨房', '卫生间'];
  await withPlatformTransaction(async tx => {
    const template = (await one(tx, sql`insert into app.portfolio_templates(enterprise_id,key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by)
      values(${tenants[0]},'test-cream-96',${content.title},${content.description},${content.primaryStyle},'["三居"]'::jsonb,${content.rooms},${content.area},'420500','宜昌市','西陵区',
      ${JSON.stringify(content)}::jsonb,'published',1,${staff[0][0]},${staff[0][0]}) returning id`))!;
    for (const [position, space] of spaces.entries()) await tx.execute(sql`insert into app.portfolio_template_assets(enterprise_id,template_id,image_base64,content_hash,space,position)
      values(${tenants[0]},${String(template.id)},${imageBase64},${prefix + position},${space},${position})`);
  });
  const listed = await exec('templates', {}, 1); assert.equal(listed.items.length, 1);
  assert.equal((await exec('templates', {}, 1, 1)).items.length, 0);
  const row = listed.items[0]; assert.equal(row.asset_count, 6); assert.ok(row.cover_asset_id); assert.equal(row.status, 'published');
  const detail = await exec('templateDetail', { templateId: row.id }, 1); assert.equal(detail.images.length, 6); assert.equal(detail.template.content.source, 'template_library');
  await assert.rejects(exec('templateDetail', { templateId: row.id }, 1, 1), /not_found/);
  const sampleBytes = Buffer.from(String((await exec('templateAsset', { templateId: row.id, assetId: row.cover_asset_id }, 1)).image_base64), 'base64');
  assert.ok(sampleBytes.length > 0); assert.deepEqual([...sampleBytes.slice(0, 4)], [...Buffer.from(String(imageBase64), 'base64').slice(0, 4)]);
  await assert.rejects(exec('instantiateTemplate', { templateId: row.id, authorId: staff[0][2] }, 1), /forbidden/);
  await assert.rejects(exec('instantiateTemplate', { templateId: row.id }, 0), /invalid_message/);
  const instantiated = await exec('instantiateTemplate', { templateId: row.id }, 1), wid = String(instantiated.id);
  const work = await exec('detail', { workId: wid }, 1);
  assert.equal(work.work.author_id, staff[0][1]); assert.equal(work.work.kind, 'designer_work'); assert.equal(work.head.status, 'draft');
  assert.equal(work.head.content.source, 'template_library'); assert.equal(work.head.content.images.length, 6); assert.ok(work.assets.length >= 6);
  assert.equal(work.head.content.coverAssetId, work.head.content.images[0].assetId);
  assert.ok(work.head.content.images.every((i: Row) => i.kind === 'render' && i.aiGenerated === true && i.showroom === false && i.space));
  await assert.rejects(exec('detail', { workId: wid }, 2), /not_found/);
  const keyed = await exec('instantiateTemplate', { templateId: row.id }, 1, 0, '00000000-0000-4000-8000-000000000001');
  assert.deepEqual(keyed, await exec('instantiateTemplate', { templateId: row.id }, 1, 0, '00000000-0000-4000-8000-000000000001'));
  const editable = await exec('save', { workId: wid, expectedVersion: 1, content: { ...contents(), title: '由素材创建', source: 'template_library', images: [], coverAssetId: null } }, 1);
  assert.equal(editable.version, 2);
  const delegated = await exec('instantiateTemplate', { templateId: row.id, authorId: staff[0][2] }, 0);
  assert.equal((await exec('detail', { workId: String(delegated.id) }, 0)).work.author_id, staff[0][2]);
  const token = await new SignJWT({ id: staff[0][1], username: prefix, role: 'designer', enterpriseId: tenants[0], permissions: ['case-publishing'], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff[0][1]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const headers = { cookie: 'auth_token=' + token };
  const httpList = await GET(new NextRequest('http://localhost:3006/api/portfolio/templates', { headers }), { params: Promise.resolve({ path: ['templates'] }) }); assert.equal(httpList.status, 200);
  const httpAsset = await GET(new NextRequest(`http://localhost:3006/api/portfolio/templates/${row.id}/assets/${row.cover_asset_id}`, { headers }), { params: Promise.resolve({ path: ['templates', String(row.id), 'assets', String(row.cover_asset_id)] }) });
  assert.equal(httpAsset.status, 200); assert.equal(httpAsset.headers.get('content-type'), 'image/jpeg');
  await withPlatformTransaction(tx => tx.execute(sql`update app.portfolio_templates set status='retired' where enterprise_id=${tenants[0]} and key='test-cream-96'`));
  assert.equal((await exec('templates', {}, 1)).items.length, 0);
  await assert.rejects(exec('templateAsset', { templateId: row.id, assetId: row.cover_asset_id }, 1), /not_found/);
  const httpRetiredAsset = await GET(new NextRequest(`http://localhost:3006/api/portfolio/templates/${row.id}/assets/${row.cover_asset_id}`, { headers }), { params: Promise.resolve({ path: ['templates', String(row.id), 'assets', String(row.cover_asset_id)] }) });
  assert.equal(httpRetiredAsset.status, 404);
  await assert.rejects(exec('instantiateTemplate', { templateId: row.id }, 1), /not_found/);
});

test('platform templates are readable and instantiable across tenants while enterprise templates stay tenant-only', async () => {
  const content = { title: '跨企业共享样本 · 96㎡奶油风三居', description: '平台共享回归用示例。', primaryStyle: '奶油风', secondaryStyles: [], cityCode: '420500', cityName: '宜昌市', district: '西陵区', communityId: null, area: 96, rooms: '三房两厅', layoutTypes: ['三居'], authorRole: '', source: 'template_library', authorization: '', rightsUntil: null, highlights: ['共享回归'], materials: ['乳胶漆'], palette: [{ name: '奶油白', hex: '#F5F0E6' }], tours: [], showOnProfile: true, recommendable: true };
  let platformId = '', tenantTemplateId = '';
  await withPlatformTransaction(async tx => {
    const platform = (await one(tx, sql`insert into app.platform_portfolio_templates(key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by)
      values(${prefix + '-platform'},${content.title},${content.description},${content.primaryStyle},'["三居"]'::jsonb,${content.rooms},${content.area},'420500','宜昌市','西陵区',
      ${JSON.stringify(content)}::jsonb,'published',1,${staff[0][0]},${staff[0][0]}) returning id`))!;
    platformId = String(platform.id);
    for (const [position, space] of ['客厅', '餐厅', '主卧'].entries()) await tx.execute(sql`insert into app.platform_portfolio_template_assets(template_id,image_base64,content_hash,space,position)
      values(${platformId},${imageBase64},${prefix + 'platform-' + position},${space},${position})`);
    const own = (await one(tx, sql`insert into app.portfolio_templates(enterprise_id,key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by)
      values(${tenants[0]},${prefix + '-tenant'},${'仅本企业样本'},${'仅本企业可见'},${'原木风'},'["三居"]'::jsonb,${'三房两厅'},88,'420500','宜昌市','西陵区',
      ${JSON.stringify({ ...content, title: '仅本企业样本' })}::jsonb,'published',2,${staff[0][0]},${staff[0][0]}) returning id`))!;
    tenantTemplateId = String(own.id);
  });
  const platformRef = 'platform-' + platformId, tenantRef = 'enterprise-' + tenantTemplateId;
  const shared = await exec('templates', {}, 1, 1);
  assert.equal(shared.items.filter(item => item.id === platformRef).length, 1);
  assert.equal(shared.items.find(item => item.id === platformRef)?.scope, 'platform');
  assert.equal(shared.items.some(item => item.id === tenantRef), false);
  assert.ok((await exec('templates', {}, 1, 0)).items.some(item => item.id === platformRef));
  const detail = await exec('templateDetail', { templateId: platformRef }, 1, 1);
  assert.equal(detail.images.length, 3); assert.equal(detail.template.scope, 'platform');
  const bytes = Buffer.from(String((await exec('templateAsset', { templateId: platformRef, assetId: detail.images[0].id }, 1, 1)).image_base64), 'base64');
  assert.ok(bytes.length > 0);
  const created = await exec('instantiateTemplate', { templateId: platformRef }, 1, 1);
  const work = await exec('detail', { workId: String(created.id) }, 1, 1);
  assert.equal(work.work.author_id, staff[1][1]); assert.equal(work.work.kind, 'designer_work');
  assert.equal(work.head.content.images.length, 3); assert.equal(work.head.content.source, 'template_library');
  assert.ok(work.head.content.images.every((image: Row) => image.kind === 'render' && image.aiGenerated === true));
  assert.equal((await withTenantTransaction(tenants[1], tx => rows(tx, sql`update app.platform_portfolio_templates set title='跨租户改写' where id=${platformId} returning id`))).length, 0);
  await assert.rejects(withTenantTransaction(tenants[0], tx => tx.execute(sql`insert into app.platform_portfolio_templates(key,title,primary_style,layout_types,city_code,content,status,created_by,updated_by)
    values(${prefix + '-denied'},'越权模板','奶油风','[]'::jsonb,'420500','{}'::jsonb,'published',${staff[0][0]},${staff[0][0]})`)),
    (error: unknown) => /row-level security|policy/.test(String((error as { cause?: Error }).cause?.message ?? (error as Error).message)));
  await withPlatformTransaction(tx => tx.execute(sql`update app.platform_portfolio_templates set status='retired',version=version+1 where id=${platformId}`));
  assert.equal((await exec('templates', {}, 1, 1)).items.some(item => item.id === platformRef), false);
  await assert.rejects(exec('templateAsset', { templateId: platformRef, assetId: detail.images[0].id }, 1, 1), /not_found/);
  await assert.rejects(exec('instantiateTemplate', { templateId: platformRef }, 1, 1), /not_found/);
});

test('platform template management enforces platform-admin auth and versioned publish/unpublish', async () => {
  const content = { title: '平台管理回归样本', description: '管理回归', primaryStyle: '现代简约', secondaryStyles: [], cityCode: '420500', cityName: '宜昌市', district: '西陵区', communityId: null, area: 89, rooms: '三房两厅', layoutTypes: ['三居'], authorRole: '', source: 'template_library', authorization: '', rightsUntil: null, highlights: [], materials: [], palette: [], tours: [], showOnProfile: true, recommendable: true };
  let id = '';
  await withPlatformTransaction(async tx => {
    const row = (await one(tx, sql`insert into app.platform_portfolio_templates(key,title,description,primary_style,layout_types,rooms,area,city_code,city_name,district,content,status,sort_order,created_by,updated_by)
      values(${prefix + '-mgmt'},${content.title},${content.description},${content.primaryStyle},'["三居"]'::jsonb,${content.rooms},${content.area},'420500','宜昌市','西陵区',
      ${JSON.stringify(content)}::jsonb,'published',9,${staff[0][0]},${staff[0][0]}) returning id`))!;
    id = String(row.id);
    await tx.execute(sql`insert into app.platform_portfolio_template_assets(template_id,image_base64,content_hash,space,position)
      values(${id},${imageBase64},${prefix + 'mgmt-1'},'客厅',0)`);
  });
  assert.ok((await listPlatformTemplates({})).items.some(item => item.id === id));
  const detail = await platformTemplateDetail(id);
  assert.equal(detail.images.length, 1);
  const retired = await setPlatformTemplateStatus(id, 'retired', detail.template.version, staff[0][0]);
  assert.equal(retired.status, 'retired');
  assert.equal((await setPlatformTemplateStatus(id, 'retired', detail.template.version, staff[0][0])).status, 'retired');
  await assert.rejects(setPlatformTemplateStatus(id, 'published', detail.template.version, staff[0][0]), /version_conflict/);
  const published = await setPlatformTemplateStatus(id, 'published', retired.version, staff[0][0]);
  assert.equal(published.status, 'published');
  const audits = await withPlatformTransaction(tx => one(tx, sql`select count(*)::int as n from app.platform_portfolio_template_audits where template_id=${id}`));
  assert.equal(Number(audits!.n), 2);
  const designerToken = await new SignJWT({ id: staff[0][1], username: prefix, role: 'designer', enterpriseId: tenants[0], permissions: ['case-publishing'], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff[0][1]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const denied = await platformTemplatesGET(new NextRequest('http://localhost:3006/api/platform/portfolio-templates', { headers: { cookie: 'auth_token=' + designerToken } }), { params: Promise.resolve({ path: [] }) });
  assert.equal(denied.status, 403);
  const adminToken = await new SignJWT({ id: staff[0][0], username: prefix, role: 'super_admin', enterpriseId: tenants[0], permissions: [], mustChangePassword: false }).setProtectedHeader({ alg: 'HS256' }).setSubject(staff[0][0]).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const headers = { cookie: 'auth_token=' + adminToken };
  const listed = await platformTemplatesGET(new NextRequest('http://localhost:3006/api/platform/portfolio-templates', { headers }), { params: Promise.resolve({ path: [] }) });
  assert.equal(listed.status, 200);
  const patched = await platformTemplatesPATCH(new NextRequest('http://localhost:3006/api/platform/portfolio-templates/' + id + '/status', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'retired', expectedVersion: published.version }),
  }), { params: Promise.resolve({ path: [id, 'status'] }) });
  assert.equal(patched.status, 200);
});

test('agent designer projection drops withdrawn, replaced, disabled and expired items while the answer stays available', async () => {
  const created = await exec('create', {}, 1), wid = String(created.id);
  const upload = await exec('upload', { workId: wid, expectedVersion: 1, imageBase64 }, 1);
  const content = () => ({ ...contents(), title: '投影校验作品', layoutTypes: ['三居'],
    images: [{ assetId: String(upload.assetId), kind: 'render', aiGenerated: true, showroom: false, caption: '' }], coverAssetId: String(upload.assetId) });
  const detail = async () => await exec('detail', { workId: wid }) as Row & { work: Row; head: Row };
  const currentVersion = async () => Number((await detail()).work.version);
  const save = async (value: Row) => await exec('save', { workId: wid, expectedVersion: await currentVersion(), content: value }, 1);
  const submit = async () => await exec('submit', { workId: wid, expectedVersion: await currentVersion() }, 1);
  const publish = async () => await exec('publish', { workId: wid, expectedVersion: await currentVersion() }, 0);
  await save(content()); await submit(); await publish();
  const firstVersion = String((await detail()).work.published_version_id);
  const snapshot = (versionId: string) => ({ cityCode: '330100', style: '原木风', layout: '三居', communityId: null, items: [{ workId: wid, versionId }] });
  const { runId, messageId } = await withTenantTransaction(tenants[0], async tx => {
    const seq = await one(tx, sql`select coalesce(max(seq),0) as n from app.assistant_messages where enterprise_id=${tenants[0]} and conversation_id=${conversations[0]}`);
    const trigger = await one(tx, sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content)
      values(${tenants[0]},${conversations[0]},${Number(seq!.n) + 1},'user',${users[0]},${JSON.stringify({ version: 1, blocks: [{ type: 'text', text: '帮我找擅长三居原木风的设计师' }] })}::jsonb) returning id`);
    const run = await one(tx, sql`insert into app.assistant_runs(enterprise_id,conversation_id,trigger_kind,trigger_message_id,policy_snapshot,context_revision,knowledge_epoch,status,started_at)
      values(${tenants[0]},${conversations[0]},'user_message',${String(trigger!.id)},'{}'::jsonb,1,1,'running',now()) returning id`);
    const output = await one(tx, sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,content,run_id)
      values(${tenants[0]},${conversations[0]},${Number(seq!.n) + 2},'assistant',${JSON.stringify({ version: 1, blocks: [{ type: 'text', text: '按三居原木风为你找到公开作品。' }] })}::jsonb,${String(run!.id)}) returning id`);
    await tx.execute(sql`update app.assistant_runs set output_message_id=${String(output!.id)},status='succeeded',completed_at=now() where enterprise_id=${tenants[0]} and id=${String(run!.id)}`);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint)
      values(${tenants[0]},${String(run!.id)},2000,'agent_designer_result','designers.search.v1',1,'succeeded',${JSON.stringify(snapshot(firstVersion))}::jsonb)`);
    return { runId: String(run!.id), messageId: String(output!.id) };
  });
  const setSnapshot = (versionId: string) => withTenantTransaction(tenants[0], tx => tx.execute(sql`update app.assistant_run_steps
    set private_checkpoint=${JSON.stringify(snapshot(versionId))}::jsonb where enterprise_id=${tenants[0]} and run_id=${runId} and step_seq=2000`));
  const projection = async () => await withTenantTransaction(tenants[0], async tx => {
    const conversation = (await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${tenants[0]} and id=${conversations[0]}`))!;
    const message = (await one(tx, sql`select * from app.assistant_messages where enterprise_id=${tenants[0]} and id=${messageId}`))!;
    return await projectMessage(tx, customers[0], conversation, message) as Row & {
      available: boolean; designerRecommendation: { items: Array<{ defaultAvatar: string; work: { id: string; versionId: string } }> } | null };
  });
  let projected = await projection();
  assert.equal(projected.available, true); assert.equal(projected.designerRecommendation?.items.length, 1);
  assert.equal(projected.designerRecommendation?.items[0].work.id, wid);
  const authorId = staff[0][1];
  const profile = await exec('profile', { authorId });
  const updatedAvatar = { ...(profile.content as Row), defaultAvatar: 'female' };
  await exec('saveProfile', { authorId, expectedVersion: profile.version, content: updatedAvatar });
  assert.equal((await projection()).designerRecommendation?.items[0].defaultAvatar, 'female');
  const catalog = new PortfolioCatalog(customers[0], conversations[0]);
  assert.equal((await catalog.designer(authorId)).authorCard.defaultAvatar, 'female');
  assert.equal((await catalog.work(wid, firstVersion)).authorCard.defaultAvatar, 'female');
  await exec('withdraw', { workId: wid, expectedVersion: await currentVersion() }, 0);
  projected = await projection(); assert.equal(projected.available, true); assert.equal(projected.designerRecommendation, null);
  await exec('newDraft', { workId: wid, expectedVersion: await currentVersion() }, 1);
  await save({ ...content(), title: '投影校验作品二版' }); await submit(); await publish();
  const secondVersion = String((await detail()).work.published_version_id);
  assert.notEqual(secondVersion, firstVersion);
  projected = await projection(); assert.equal(projected.available, true); assert.equal(projected.designerRecommendation, null);
  await setSnapshot(secondVersion); projected = await projection();
  assert.equal(projected.designerRecommendation?.items[0].work.versionId, secondVersion);
  await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${staff[0][1]}`));
  try { projected = await projection(); assert.equal(projected.available, true); assert.equal(projected.designerRecommendation, null); }
  finally { await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${staff[0][1]}`)); }
  await exec('newDraft', { workId: wid, expectedVersion: await currentVersion() }, 1);
  await save({ ...content(), rightsUntil: new Date(Date.now() + 3600000).toISOString() }); await submit(); await publish();
  const rightsVersion = String((await detail()).work.published_version_id);
  await setSnapshot(rightsVersion); projected = await projection();
  assert.equal(projected.designerRecommendation?.items[0].work.versionId, rightsVersion);
  const now = Date.now; Date.now = () => now() + 7200000;
  try { projected = await projection(); assert.equal(projected.available, true); assert.equal(projected.designerRecommendation, null); }
  finally { Date.now = now; }
});

test('versioned work contacts expose only consented channels and revoke QR, actor and consultation access', async () => {
  const eid = tenants[0];
  const author = await withPlatformTransaction(tx => one(tx, sql`insert into app.admin_users
    (enterprise_id,username,password_hash,role,status,must_change_password,display_name,phone)
    values(${eid},${prefix + '-contact'},'test-only','designer','active',false,'合成手测·联系设计师','19900000000') returning id`));
  const aid = String(author!.id);
  const service = new PortfolioService({ enterpriseId: eid, adminId: aid });
  const run = (action: string, body: Row) => service.execute(action, body, randomUUID());
  const created = await run('create', { content: { title: '合成手测·原木设计师联系方式' } });
  const wid = String(created.id);
  const asset = await run('upload', { workId: wid, expectedVersion: 1, imageBase64 });
  const cover = String(asset.assetId);
  await run('save', { workId: wid, expectedVersion: 1, content: { ...contents(), title: '合成手测·原木设计师联系方式',
    showOnProfile: true, recommendable: true, images: [{ assetId: cover, kind: 'render', aiGenerated: true, showroom: false, caption: '合成效果图' }], coverAssetId: cover } });
  await run('submit', { workId: wid, expectedVersion: 2 });
  await exec('publish', { workId: wid, expectedVersion: 3 }, 0);
  const published = String((await exec('detail', { workId: wid }, 0)).work.published_version_id);
  const cid = String((await new ConversationService(customers[0]).create(randomUUID())).id);
  const profileContent = { template: 'notebook', bio: '隔离测试作者', cities: [{ code: '330100', name: '杭州市', districts: [] }], styles: ['原木风'], featuredWorkIds: [wid] };
  const contact = { wechatId: 'synthetic_work_contact', phone: '999 0000 0000', publishWechat: false, publishPhone: false, allowInApp: false };
  const token = await new SignJWT({ id: aid, username: prefix + '-contact', role: 'designer', enterpriseId: eid, permissions: ['case-publishing'], mustChangePassword: false })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(aid).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const profileUrl = 'http://localhost:3006/api/portfolio/profiles/' + aid;
  const profileContext = { params: Promise.resolve({ path: ['profiles', aid] }) };
  const put = (expectedVersion: number, changes: Row, requestKey = randomUUID()) => PUT(new NextRequest(profileUrl, { method: 'PUT',
    headers: { cookie: 'auth_token=' + token, 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
    body: JSON.stringify({ expectedVersion, content: profileContent, contact: changes }),
  }), profileContext);
  const readPublic = async (leaf: string, params: Record<string, string>, user = 0, authorId = aid) => {
    const uid = users[user], jwt = await signMiniProgramToken({ id: uid, sub: uid, mode: 'customer', role: 'user', contextVersion: 1, source: 'wechat' });
    const route = ['conversations', cid, 'portfolio', 'designers', authorId, leaf];
    return assistantHttp(new Request('http://localhost:3006/api/miniprogram/assistant/' + route.join('/') + '?' + new URLSearchParams(params),
      { headers: { Authorization: 'Bearer ' + jwt } }), route);
  };
  const source = { workId: wid, versionId: published };
  const qr = (revision: number) => readPublic('contact-qr', { ...source, format: 'base64', revision: String(revision) });
  const publicData = async () => {
    const response = await readPublic('contact', source);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };

  const draft = await put(0, { ...contact, qrImageBase64: imageBase64 });
  assert.equal(draft.status, 200);
  assert.equal((await draft.json()).data.contact.qrAvailable, true);
  const hidden = await publicData();
  assert.equal(hidden.wechatId, ''); assert.equal(hidden.phone, ''); assert.equal(hidden.qrAvailable, false); assert.equal(hidden.allowInApp, true);
  assert.equal((await qr(1)).status, 404);
  const privateQr = await GET(new NextRequest(profileUrl + '/contact-qr', { headers: { cookie: 'auth_token=' + token } }),
    { params: Promise.resolve({ path: ['profiles', aid, 'contact-qr'] }) });
  assert.equal(privateQr.status, 200); assert.equal(privateQr.headers.get('content-type'), 'image/jpeg');
  await assert.rejects(exec('profileContactQr', { authorId: aid }, 2), /portfolio_forbidden/);

  const publish = { ...contact, publishWechat: true, publishPhone: true };
  const missingConsent = await put(1, publish);
  assert.equal(missingConsent.status, 422); assert.equal((await missingConsent.json()).error, 'portfolio_contact_consent_required');
  const requestKey = randomUUID();
  const saved = await put(1, { ...publish, consent: true }, requestKey);
  assert.equal(saved.status, 200);
  const savedData = (await saved.json()).data;
  const replay = await put(1, { ...publish, consent: true }, requestKey);
  assert.deepEqual((await replay.json()).data, savedData);
  assert.equal((await put(1, { ...publish, consent: true })).status, 409);
  const visible = await publicData();
  assert.equal(visible.wechatId, contact.wechatId); assert.equal(visible.phone, '99900000000');
  assert.equal(visible.qrAvailable, true); assert.equal(visible.allowInApp, false); assert.equal(visible.author.id, aid);
  assert.ok(!JSON.stringify(visible).includes('19900000000'));
  for (const field of ['qrImageBase64', 'consentBy', 'consentAt']) assert.ok(!(field in visible));
  const qrResponse = await qr(visible.revision);
  assert.equal(qrResponse.status, 200); assert.match((await qrResponse.json()).data.imageBase64, /^\/9j\//);
  assert.equal((await readPublic('contact', source, 1)).status, 404);
  assert.equal((await readPublic('contact', source, 0, staff[0][1])).status, 404);
  const catalog = new PortfolioCatalog(customers[0], cid);
  assert.equal((await catalog.work(wid, published)).authorCard.id, aid);
  await assert.rejects(catalog.contact(wid, { versionId: published }, randomUUID()), /portfolio_contact_disabled/);

  for (const role of ['enterprise_admin', 'admin', 'super_admin']) {
    const manager = await withPlatformTransaction(tx => one(tx, sql`insert into app.admin_users
      (enterprise_id,username,password_hash,role,status,must_change_password,display_name)
      values(${eid},${prefix + '-contact-' + role},'test-only',${role},'active',false,'合成手测·资料管理') returning id`));
    const managerService = new PortfolioService({ enterpriseId: eid, adminId: String(manager!.id) });
    const loaded = await managerService.execute('profile', { authorId: aid });
    await managerService.execute('saveProfile', { authorId: aid, expectedVersion: loaded.version, content: profileContent }, randomUUID());
  }
  const retained = await publicData();
  assert.equal(retained.wechatId, visible.wechatId); assert.equal(retained.qrAvailable, true);
  assert.equal((await qr(visible.revision)).status, 404);
  const revoked = await put(retained.revision, { ...publish, publishWechat: false, publishPhone: false });
  assert.equal(revoked.status, 200);
  const afterRevoke = await publicData();
  assert.equal(afterRevoke.wechatId, ''); assert.equal(afterRevoke.phone, '');
  assert.equal(afterRevoke.qrAvailable, false); assert.equal(afterRevoke.allowInApp, true);
  assert.equal((await qr(retained.revision)).status, 404);
  await exec('withdraw', { workId: wid, expectedVersion: Number((await exec('detail', { workId: wid }, 0)).work.version) }, 0);
  assert.equal((await readPublic('contact', source)).status, 404);
});
