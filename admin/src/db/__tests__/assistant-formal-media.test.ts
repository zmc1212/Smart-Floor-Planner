import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { hydrateImages, resolveAgentMedia, type MediaDependency } from '@/lib/assistant/agent/media-context';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import { fingerprint, type ActorContext } from '@/lib/assistant/contracts';
import type { ModelMessage } from '@/lib/assistant/contracts/model';

const prefix = 'synthetic-d2-formal-media-' + randomUUID();
const fixture = { enterprises: [] as string[], users: [] as string[], leadId: '', planId: '', conversationId: '', formalId: '', imageId: '' };
const report = { scope: 'D2 formal-source eligibility only; real isolated services/auth/rendering; no model, embedding or native acceptance',
  started: new Date().toISOString(), fixture, checks: [] as string[], networkRequests: 0, providerAttempts: 0, cleaned: false };
const originalFetch = globalThis.fetch;
const save = () => {
  if (process.env.ASSISTANT_FORMAL_MEDIA_EVIDENCE) fs.writeFileSync(path.join(process.env.ASSISTANT_FORMAL_MEDIA_EVIDENCE, 'formal-media-service.json'), JSON.stringify(report, null, 2));
};
const layout = { version: 4, measurementMode: 'surveying', surveyGraph: { kind: 'survey-wall-graph', activeFloorId: 'f', floors: [{
  id: 'f', name: '一层', ceilingHeightMm: 2800,
  nodes: [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: 4000, yMm: 0 }, { id: 'c', xMm: 4000, yMm: 3000 }, { id: 'd', xMm: 0, yMm: 3000 }],
  walls: [{ id: 'ab', startNodeId: 'a', endNodeId: 'b' }, { id: 'bc', startNodeId: 'b', endNodeId: 'c' }, { id: 'cd', startNodeId: 'c', endNodeId: 'd' }, { id: 'da', startNodeId: 'd', endNodeId: 'a' }],
  openings: [], spaces: [{ id: 'study', name: '书房', closed: true, wallIds: ['ab', 'bc', 'cd', 'da'] }],
}] } };
let actor: ActorContext, media: AssistantMediaService, formalRef: MediaDependency, photoRef: MediaDependency, checkpoint: ModelMessage[], snapshot: Buffer;
async function setLayout(value: unknown) {
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.floor_plans set layout_data=${JSON.stringify(value)}::jsonb where id=${fixture.planId}`));
}
const resolve = (ref = formalRef, enterpriseId = actor.enterpriseId, conversationId = fixture.conversationId) => withTenantTransaction(enterpriseId, tx => resolveAgentMedia(tx, enterpriseId, conversationId, ref));
async function http(userId?: string, enterpriseId = actor.enterpriseId) {
  const token = userId ? await signMiniProgramToken({ sub: userId, id: userId, mode: 'customer', role: 'user', enterpriseId, contextVersion: 1, source: 'wechat' }) : undefined;
  return assistantHttp(new Request(`http://localhost/api/miniprogram/assistant/conversations/${fixture.conversationId}/media/${fixture.formalId}`, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  }), ['conversations', fixture.conversationId, 'media', fixture.formalId]);
}
async function unavailable(reason: string) {
  await assert.rejects(media.read(fixture.conversationId, fixture.formalId), /assistant_resource_not_found/, reason + ': private read');
  assert.equal((await media.list(fixture.conversationId)).items.some(m => m.id === fixture.formalId), false, reason + ': reentry');
  assert.equal(await resolve(), undefined, reason + ': Agent source');
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => hydrateImages(tx, actor.enterpriseId, fixture.conversationId, checkpoint)), /context_changed/, reason + ': checkpoint');
  assert.equal((await http(fixture.users[0])).status, 404, reason + ': bearer read');
  assert.ok(await resolve(photoRef), reason + ': independent private photo remains available');
  report.checks.push(reason); save();
}

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  globalThis.fetch = async () => { report.networkRequests++; throw Error('Formal media acceptance forbids external calls'); };
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${'测试专用 D2 户型图片 ' + i},${prefix + i},'active') returning id`))!.id);
      fixture.enterprises.push(enterpriseId);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${enterpriseId},true,100,200000,5000000,30,'{}'::jsonb)`);
      const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id);
      fixture.users.push(userId); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix + i})`);
    }
  });
  actor = { enterpriseId: fixture.enterprises[0], principal: { kind: 'user', userId: fixture.users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  await withTenantTransaction(actor.enterpriseId, async tx => {
    fixture.planId = String((await one(tx, sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data)
      values(${actor.enterpriseId},${fixture.users[0]},'合成正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);
    fixture.leadId = String((await one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,primary_floor_plan_id)
      values(${actor.enterpriseId},${fixture.users[0]},'合成户型图片客户','13000000000','manual',${fixture.planId}) returning id`))!.id);
  });
  fixture.conversationId = String((await new ConversationService(actor).create(randomUUID())).id);
  media = new AssistantMediaService(actor);
  const input = { leadId: fixture.leadId, floorPlanId: fixture.planId, layoutHash: fingerprint(layout), roomId: 'study' };
  const requestKey = randomUUID(), attached = await media.attachFormal(fixture.conversationId, requestKey, input);
  assert.deepEqual(await media.attachFormal(fixture.conversationId, requestKey, input), attached);
  fixture.formalId = attached.id;
  const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#8899aa' } }).png().toBuffer();
  fixture.imageId = (await media.upload(fixture.conversationId, randomUUID(), photo, 'image', '参考照片')).id;
  const refs = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select id,source_hash from app.assistant_media where conversation_id=${fixture.conversationId}`));
  const ref = (mediaId: string): MediaDependency => ({ type: 'assistant_media', id: mediaId, hash: String(refs.find(m => String(m.id) === mediaId)!.source_hash) });
  formalRef = ref(fixture.formalId); photoRef = ref(fixture.imageId);
  checkpoint = [{ role: 'user', content: [{ type: 'text', text: '书房的插座怎么安排？' }, { type: 'image', mediaId: formalRef.id, hash: formalRef.hash, mimeType: 'image/jpeg', data: '' }] }];
  snapshot = (await media.read(fixture.conversationId, fixture.formalId)).data;
  save();
});

after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of fixture.enterprises) {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${enterpriseId} and status in ('queued','running')`);
      }
      for (const userId of fixture.users) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      const attempts = await rows(tx, sql`select id from app.ai_provider_attempts where enterprise_id in (${fixture.enterprises[0] ?? '0'},${fixture.enterprises[1] ?? '0'})`);
      report.providerAttempts = attempts.length; assert.equal(attempts.length, 0); assert.equal(report.networkRequests, 0);
    });
    report.cleaned = true;
  } finally { globalThis.fetch = originalFetch; save(); await closePostgresPool(); }
});

test('owned formal image persists unchanged across valid source edits and checkpoint reentry', async () => {
  const current = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select layout_data from app.floor_plans where id=${fixture.planId}`));
  assert.deepEqual(current!.layout_data, layout, 'attaching must not write the formal graph');
  const revised = structuredClone(layout); revised.surveyGraph.floors[0].nodes[1].xMm = 4500;
  try {
    await setLayout(revised);
    assert.deepEqual((await new AssistantMediaService(actor).read(fixture.conversationId, fixture.formalId)).data, snapshot);
    const listed = (await media.list(fixture.conversationId)).items.find(m => m.id === fixture.formalId)!;
    assert.equal((listed.source as Row).layoutHash, fingerprint(layout));
    assert.ok(await resolve());
    const hydrated = await withTenantTransaction(actor.enterpriseId, tx => hydrateImages(tx, actor.enterpriseId, fixture.conversationId, checkpoint));
    assert.equal(hydrated[0].role, 'user');
    if (hydrated[0].role === 'user') assert.ok(hydrated[0].content.some(p => p.type === 'image' && p.data === snapshot.toString('base64')));
    assert.equal((await http(fixture.users[0])).status, 200);
    report.checks.push('valid later edit retains original snapshot/hash; no graph write; real reentry/checkpoint/HTTP200'); save();
  } finally { await setLayout(layout); }
});

test('invalid formal sources are rejected consistently by private reads, HTTP and Agent restoration', async () => {
  const variants = [
    ['mixed legacy layout', { ...layout, rooms: [] }],
    ['wrong graph kind', { ...layout, surveyGraph: { ...layout.surveyGraph, kind: 'legacy' } }],
    ['missing graph', { version: 4, measurementMode: 'surveying' }],
    ['non-array floors', { ...layout, surveyGraph: { ...layout.surveyGraph, floors: {} } }],
    ['string version', { ...layout, version: '4' }],
  ] as const;
  for (const [reason, value] of variants) {
    try { await setLayout(value); await unavailable(reason); }
    finally { await setLayout(layout); }
  }
  assert.ok(await resolve(), 'valid restored source is available without replacing original media');
});

test('source withdrawal, ownership, tenant and image hashes still fence restored pixels', async () => {
  const transitions = [
    { name: 'archived lead', change: sql`update app.leads set archived_at=now() where id=${fixture.leadId}`, undo: sql`update app.leads set archived_at=null where id=${fixture.leadId}` },
    { name: 'primary plan withdrawn', change: sql`update app.leads set primary_floor_plan_id=null where id=${fixture.leadId}`, undo: sql`update app.leads set primary_floor_plan_id=${fixture.planId} where id=${fixture.leadId}` },
    { name: 'customer ownership changed', change: sql`update app.leads set customer_user_id=${fixture.users[1]} where id=${fixture.leadId}`, undo: sql`update app.leads set customer_user_id=${fixture.users[0]} where id=${fixture.leadId}` },
    { name: 'plan no longer completed', change: sql`update app.floor_plans set status='draft' where id=${fixture.planId}`, undo: sql`update app.floor_plans set status='completed' where id=${fixture.planId}` },
  ];
  for (const transition of transitions) {
    try { await withTenantTransaction(actor.enterpriseId, tx => tx.execute(transition.change)); await unavailable(transition.name); }
    finally { await withTenantTransaction(actor.enterpriseId, tx => tx.execute(transition.undo)); }
  }
  assert.equal(await resolve({ ...formalRef, hash: 'wrong-hash' }), undefined);
  assert.equal(await resolve(formalRef, fixture.enterprises[1]), undefined);
  assert.equal((await http()).status, 401);
  assert.equal((await http(fixture.users[1])).status, 404);
  assert.equal((await http(fixture.users[1], fixture.enterprises[1])).status, 404);
  await media.remove(fixture.conversationId, fixture.formalId);
  assert.equal(await resolve(), undefined);
  await assert.rejects(withTenantTransaction(actor.enterpriseId, tx => hydrateImages(tx, actor.enterpriseId, fixture.conversationId, checkpoint)), /context_changed/);
  assert.ok(await resolve(photoRef));
  report.checks.push('wrong hash / cross-tenant / no bearer / other customer / deletion deny access; ordinary private photo independent'); save();
});
