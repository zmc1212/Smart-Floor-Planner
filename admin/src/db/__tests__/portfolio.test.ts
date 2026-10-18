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
import { GET, POST } from '@/app/api/portfolio/[[...path]]/route';
import type { WorkContent } from '@/lib/portfolio/contracts';
import type { ActorContext } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { readPortfolioEntry } from '@/lib/portfolio/entry';
import { decodeJwt } from 'jose';
import { HandoffService } from '@/lib/assistant/handoff/service';

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
  try { await withPlatformTransaction(async tx => { for (const eid of tenants) { await deletePortfolioData(tx, BigInt(eid)); await deleteAssistantData(tx, BigInt(eid)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${eid}`); await tx.execute(sql`delete from app.enterprises where id=${eid}`); } for (const uid of users) await tx.execute(sql`delete from app.users where id=${uid}`); }); }
  finally { await closePostgresPool(); }
});
type TestResult = Row & { head: Row & { content: WorkContent }; work: Row; versions: Array<Row & { content: WorkContent }>; items: Row[] };
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
  const data = { bio: '本人设计自述', cities: [{ code: '330100', name: '杭州市', districts: ['西湖区'] }], styles: ['原木风'], featuredWorkIds: [workId] };
  const competing = await Promise.allSettled([exec('saveProfile', { authorId: staff[0][1], expectedVersion: 0, content: data }), exec('saveProfile', { authorId: staff[0][1], expectedVersion: 0, content: data })]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1); assert.equal(competing.filter(r => r.status === 'rejected').length, 1);
  assert.deepEqual((await exec('profile', { authorId: staff[0][1] })).content, data);
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
  assert.equal((await catalog.recommend({ cityCode: '330100', style: '不存在风格' })).items.length, 0);
  await assert.rejects(new PortfolioCatalog(customers[1], conversations[0]).work(workId), /resource_not_found/);
  await assert.rejects(new PortfolioCatalog({ ...customers[0], contextVersion: 99 }, conversations[0]).work(workId), /identity_context_invalid/);
  const now = Date.now; Date.now = () => now() + 7200000;
  try { await assert.rejects(catalog.work(workId, work.versionId), /not_found/); } finally { Date.now = now; }
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
