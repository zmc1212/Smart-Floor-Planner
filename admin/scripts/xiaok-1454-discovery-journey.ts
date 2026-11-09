/** One real customer journey under enterprise 1454 for the two V1-04 surfaces that the
 * round-07 journey only read as empty lists: nearby published sites and style-based
 * designer/work recommendations. Uses the live 3006 service, real public data and the
 * exact Mini Program client calls; it never injects an answer or names an internal tool. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const root = path.resolve('..'), eid = '1454', customerId = '645', leadId = '3132';
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-1454-discovery-20261109/round-01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Retain the original round');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
fs.mkdirSync(output, { recursive: true });
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const catalogBase = 'http://127.0.0.1:3006/api/public/construction/' + eid;
const report: Row = { startedAt: new Date().toISOString(), enterpriseId: eid, scope: 'one customer journey: nearby public sites and style recommendations', checks: [], failures: [], accounting: {} };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const read = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const tenantOne = (q: ReturnType<typeof sql>) => read(tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => read(tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => (dir + '/' + path.relative(path.join(root, dir), path.join(e.parentPath, e.name))).replaceAll('\\', '/'));
}
function binding() {
  const files = ['admin/src', 'admin/scripts', 'miniprogram/packages/assistant', 'miniprogram/utils'].flatMap(walk);
  files.push('admin/scripts/xiaok-1454-discovery-journey.ts', 'admin/.env.local');
  return Object.fromEntries([...new Set(files)].sort().map(f => [f, createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex')]));
}
const before = binding();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');

async function step(name: string, fn: () => Promise<unknown>) {
  try { const data = await fn(); (report.checks as Row[]).push({ name, passed: true, data }); console.log(name + ': PASS'); return data; }
  catch (e) { (report.checks as Row[]).push({ name, passed: false, error: (e as Error).message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || (e as Error).message }); throw e; }
  finally { save(); }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const jwt = (payload: Row) => new SignJWT({ ...payload }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(payload.sub))
  .setIssuedAt().setAudience('miniprogram').setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
async function api(token: string, route: string, init: { method?: string; body?: Row; entry?: string; key?: string; expect?: number | number[] } = {}) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init.entry) headers['X-Assistant-Entry'] = init.entry;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const response = await fetch(base + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => ({})) as Row;
  const expected = init.expect ?? 200;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status),
    route + ': ' + response.status + '/' + String(data.code || data.error || ''));
  return { status: response.status, data };
}
async function catalog(route: string) {
  const response = await fetch(catalogBase + route, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'catalog ' + route + ': ' + response.status);
  return response;
}

async function main() {
  assert.ok(process.env.JWT_SECRET);
  const customerVersion = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
  const token = await jwt({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: customerVersion, source: 'wechat' });
  const entryToken = () => waitFor('entry token', async () => {
    const entry = (await api(token, '/entry-context', { body: { leadId } })).data.data as Row;
    return entry.entryToken ? String(entry.entryToken) : undefined;
  }, 30000);

  const site = await step('preflight: idle queue and real public material', async () => {
    const queue = await platformOne(sql`select count(*)::int n from app.assistant_jobs where status in ('queued','running')`);
    assert.equal(queue!.n, 0, 'No journey may start on an active queue');
    const published = (await tenantRows(sql`select s.id,s.project_id,s.status,s.current_version_id,v.content
      from app.construction_public_sites s join app.construction_public_versions v
        on v.enterprise_id=s.enterprise_id and v.site_id=s.id and v.id=s.current_version_id
      where s.enterprise_id=${eid} and s.status='published' order by s.id`)) as Row[];
    assert.ok(published.length > 0, 'A published public site is required for this journey');
    const s = published[0], content = s.content as Row;
    assert.ok(content.cityCode && content.cityName && content.district, 'Published site carries an area');
    const works = (await tenantRows(sql`select w.id,v.content from app.portfolio_works w join app.portfolio_versions v
      on v.enterprise_id=w.enterprise_id and v.id=w.head_version_id
      where w.enterprise_id=${eid} and v.status='published' and w.withdrawn=false order by w.id`)) as Row[];
    assert.ok(works.length > 0, 'A published portfolio work is required for this journey');
    const work = works.find(w => String((w.content as Row).primaryStyle || '').includes('原木')) || works[0];
    report.accounting.before = {
      providerMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
      knowledgeMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id) };
    return { siteId: String(s.id), versionId: String(s.current_version_id), name: String(content.name),
      cityCode: String(content.cityCode), cityName: String(content.cityName), district: String(content.district),
      workId: String(work.id), style: String((work.content as Row).primaryStyle || '') };
  });

  const turn = async (cid: string, text: string) => {
    const clientMessageId = randomUUID();
    await api(token, `/conversations/${cid}/messages`, { key: clientMessageId,
      body: { clientMessageId, content: { version: 1, blocks: [{ type: 'text', text }] } }, expect: 202 });
    const run = await waitFor('reply: ' + text.slice(0, 12), async () => {
      const r = await tenantOne(sql`select id,status,error_code,policy_snapshot,output_message_id from app.assistant_runs
        where enterprise_id=${eid} and conversation_id=${cid} and purpose='reply' order by id desc limit 1`);
      return r && !['queued', 'running'].includes(String(r.status)) ? r : undefined;
    }, 420000);
    const messages = (await api(token, `/conversations/${cid}/messages?limit=50`)).data.data as Row;
    const answer = ((messages.items || []) as Row[]).find(m => String(m.id) === String(run.output_message_id));
    assert.ok(answer, 'Assistant message persisted for ' + text.slice(0, 12));
    assert.equal(String(run.status), 'succeeded', 'Reply failed: ' + String(run.error_code || ''));
    return { runId: String(run.id), replyId: String(run.output_message_id),
      runtime: ((run.policy_snapshot as Row)?.agentRuntime as Row)?.protocol || null,
      text: String(((answer.content as Row)?.blocks as Row[] || []).map(b => b.text || '').join('')) };
  };

  const chat = await step('customer opens the assistant and asks for nearby public sites naturally', async () => {
    const created = (await api(token, '/conversations', { body: { entryToken: await entryToken() }, key: randomUUID() })).data.data as Row;
    const cid = String(created.id);
    const first = await turn(cid, `我们住在${site.cityName}${site.district}，想看看附近已经公开的工地，能围观吗？`);
    return { conversationId: cid, first };
  });

  const sites = await step('nearby site list answers the request with the authorized published site', async () => {
    const cid = String(chat.conversationId), replyId = String((chat.first as Row).replyId);
    const data = (await api(token, `/conversations/${cid}/public-sites/recommendations?replyId=${replyId}`)).data.data as Row;
    const items = (data.items || []) as Row[];
    assert.ok(items.length > 0, 'Recommendations must contain the published site');
    const item = items.find(i => String(i.id) === site.siteId);
    assert.ok(item, 'The published site in the stated district is recommended');
    assert.equal(String(item.district), site.district);
    assert.equal(data.needRegion, false);
    const detail = await (await catalog(`/sites/${site.siteId}?versionId=${site.versionId}`)).json() as Row;
    const material = detail.data as Row;
    assert.equal(String(material.id), site.siteId);
    assert.equal(String(material.cityName), site.cityName);
    const photos = (material.photos || []) as Row[];
    assert.ok(photos.length > 0, 'Published material exposes its authorized photo');
    const photo = await catalog(`/sites/${site.siteId}/media/${String(photos[0].id)}?versionId=${site.versionId}`);
    const bytes = Buffer.from(await photo.arrayBuffer());
    assert.ok(bytes.length > 0 && String(photo.headers.get('content-type')).startsWith('image/'));
    return { replyId, items: items.map(i => ({ id: String(i.id), name: String(i.name), district: String(i.district), stageName: String(i.stageName) })),
      detail: { name: String(material.name), excerpts: ((material.excerpts || []) as string[]).length, photos: photos.length, bytes: bytes.length },
      answer: String((chat.first as Row).text).slice(0, 300) };
  });

  const works = await step('style request returns matching public designers and works with reasons', async () => {
    const cid = String(chat.conversationId);
    const second = await turn(cid, '我比较喜欢原木风，有没有合适的设计师作品可以看看？');
    const data = (await api(token, `/conversations/${cid}/portfolio/recommendations?replyId=${second.replyId}`)).data.data as Row;
    const items = (data.items || []) as Row[];
    assert.ok(items.length > 0, 'Style recommendations must return at least one public work');
    const item = items[0];
    assert.equal(String((item.work as Row).primaryStyle), site.style.includes('原木') ? '原木风' : String((item.work as Row).primaryStyle));
    assert.ok(String(item.reason || '').length > 0, 'A recommendation explains why it matches');
    const work = (await api(token, `/conversations/${cid}/portfolio/works/${String((item.work as Row).id)}?versionId=${String((item.work as Row).versionId)}`)).data.data as Row;
    assert.equal(String(work.id), String((item.work as Row).id));
    const images = (work.images || []) as Row[];
    if (images.length) {
      const asset = await fetch(base + `/conversations/${cid}/portfolio/works/${String(work.id)}/assets/${String(images[0].assetId)}?versionId=${String(work.versionId)}`,
        { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
      assert.equal(asset.status, 200, 'Work image is readable');
    }
    return { replyId: second.replyId, items: items.map(i => ({ authorId: String(i.authorId), authorName: String(i.authorName),
      workId: String((i.work as Row).id), style: (i.work as Row).primaryStyle, reason: String(i.reason) })),
      work: { id: String(work.id), images: images.length }, answer: second.text.slice(0, 300) };
  });

  const reentry = await step('same conversation keeps both answers and recommendations on reentry', async () => {
    const cid = String(chat.conversationId);
    const detail = (await api(token, `/conversations/${cid}`)).data.data as Row;
    assert.equal(String(detail.id), cid);
    const messages = (await api(token, `/conversations/${cid}/messages?limit=50`)).data.data as Row;
    const items = (messages.items || []) as Row[];
    assert.ok(items.length >= 4, 'Both questions and answers persist');
    const again = (await api(token, `/conversations/${cid}/public-sites/recommendations`)).data.data as Row;
    assert.ok(((again.items || []) as Row[]).some(i => String(i.id) === site.siteId), 'Reentry still lists the published site');
    const listed = (await api(token, '/conversations?limit=20', { entry: await entryToken() })).data.data as Row;
    assert.ok(((listed.items || []) as Row[]).some(c => String(c.id) === cid), 'Conversation remains listed');
    return { messages: items.length, sites: ((again.items || []) as Row[]).length };
  });

  const elsewhere = await step('a different city is not answered with this site', async () => {
    const cid = String(chat.conversationId);
    const third = await turn(cid, '如果我人在北京朝阳区，那边有可以看的工地吗？');
    const data = (await api(token, `/conversations/${cid}/public-sites/recommendations?replyId=${third.replyId}`)).data.data as Row;
    const items = (data.items || []) as Row[];
    assert.ok(!items.some(i => String(i.id) === site.siteId), 'A Beijing request must not return the Yichang site');
    assert.equal(data.needRegion, items.length === 0);
    return { replyId: third.replyId, items: items.length, needRegion: data.needRegion, answer: third.text.slice(0, 300) };
  });

  report.accounting.after = {
    providerMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.ai_provider_attempts`))!.id),
    knowledgeMax: String((await platformOne(sql`select coalesce(max(id),0) id from app.assistant_knowledge_attempts`))!.id) };
  const after = binding();
  report.bindingAfter = createHash('sha256').update(JSON.stringify(after)).digest('hex');
  report.drift = Object.keys(after).filter(f => before[f] !== after[f]);
  report.finishedAt = new Date().toISOString();
  save();
  console.log('drift', report.drift);
}

main().then(() => closePostgresPool()).catch(async error => {
  save();
  console.error(error);
  await closePostgresPool().catch(() => {});
  process.exitCode = 1;
});
