import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { GET } from '@/app/api/assistant/consultations/[[...path]]/route';
import { AdminUserRepository } from '@/db/repositories';
import { one, rows } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { signAdminSession } from '@/lib/admin-session';
import type { ActorContext, MessageContent } from '@/lib/assistant/contracts';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import type { ConsultationDetail, ConsultationPage } from '@/lib/assistant/core/consultation-history';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { closePostgresPool } from '@/lib/postgresql';
import { lockAssistantAcceptance } from '../../../scripts/assistant-acceptance-safety.mjs';
import { xiaokTestDatabase } from './xiaok-test-database';

const text = (value: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text: value }] });

test('Enterprise consultation history includes ordinary chats with tenant, media and audit boundaries', async () => {
  const database = xiaokTestDatabase();
  const release = await lockAssistantAcceptance(database.href, { isolatedPort: database.port });
  const label = 'synthetic-consultation-history-' + randomUUID();
  const enterprises: string[] = [];
  const users: string[] = [];
  const accounts = new Map<string, { id: string; token: string }>();
  try {
    await withPlatformTransaction(async tx => {
      for (const suffix of ['main', 'control']) {
        const eid = String((await one(tx, sql`insert into app.enterprises(name,code,status)
          values(${'合成企业咨询 ' + suffix},${label + suffix},'active') returning id`))!.id);
        enterprises.push(eid);
        await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days) values(${eid},true,30)`);
        const userId = String((await one(tx, sql`insert into app.users(nickname,context_version)
          values(${'合成客户 ' + suffix},1) returning id`))!.id);
        users.push(userId);
        await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${label + suffix})`);
      }
      const fixtures = [
        { name: 'owner', role: 'enterprise_admin', eid: enterprises[0], grant: true },
        { name: 'ungranted', role: 'enterprise_admin', eid: enterprises[0], grant: false },
        { name: 'designer', role: 'designer', eid: enterprises[0], grant: true },
        { name: 'admin', role: 'admin', eid: null, grant: true },
        { name: 'super_admin', role: 'super_admin', eid: null, grant: true },
      ];
      for (const fixture of fixtures) {
        const permissions = fixture.grant ? ['assistant-knowledge'] : [];
        const aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions)
          values(${fixture.eid},${label + fixture.name},'unusable-synthetic',${fixture.role},'active',false,
            ${fixture.grant ? sql`ARRAY['assistant-knowledge']` : sql`ARRAY[]::text[]`}) returning id`))!.id);
        const admin = (await new AdminUserRepository(tx).findById(BigInt(aid)))!;
        accounts.set(fixture.name, { id: aid, token: await signAdminSession({ admin, permissions }) });
      }
    });

    const [enterpriseId, otherEnterprise] = enterprises;
    const makeActor = (index: number): ActorContext => ({ enterpriseId: enterprises[index], principal: { kind: 'user', userId: users[index] },
      contextVersion: 1, capabilities: ['assistant.chat.self'] });
    const customer = makeActor(0);
    const chat = new ConversationService(customer);
    const cid = String((await chat.create(randomUUID())).id);
    const waitingId = String((await chat.create(randomUUID())).id);
    const publicId = String((await chat.create(randomUUID())).id);
    const redactedId = String((await chat.create(randomUUID())).id);
    const otherId = String((await new ConversationService(makeActor(1)).create(randomUUID())).id);
    const media = new AssistantMediaService(customer);
    const image = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#aaccee' } }).png().toBuffer();
    const uploaded = await media.upload(cid, randomUUID(), image, 'image', '厨房');
    await new HandoffService(customer).customerWrite(waitingId, randomUUID(), { action: 'request' });
    await withTenantTransaction(enterpriseId, async tx => {
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot='{"scope":"public","kind":"public_consultation"}'::jsonb where id=${publicId}`);
      await tx.execute(sql`update app.assistant_conversations set status='archived',entry_snapshot='{"retentionRedacted":true}'::jsonb where id=${redactedId}`);
      await tx.execute(sql`update app.assistant_conversations set title='厨房装修咨询' where id=${cid}`);
      for (let index = 0; index < 22; index++) {
        await appendMessage(tx, customer, cid, { author: 'user', content: text(`合成历史消息 ${index + 1}`) });
      }
      await tx.execute(sql`update app.assistant_conversations set updated_at='2026-11-27T02:00:00.123456Z' where id=${cid}`);
    });

    const request = (name: string, path: string[] = [], query = '', eid = enterpriseId) => {
      const account = accounts.get(name);
      const headers = account ? { Cookie: `auth_token=${account.token}${eid ? `; global_tenant_id=${eid}` : ''}` } : undefined;
      return GET(new NextRequest('http://localhost:3006/api/assistant/consultations/' + path.join('/') + query, { headers }),
        { params: Promise.resolve({ path }) });
    };
    async function data<T>(response: Response): Promise<T> {
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return body.data as T;
    }
    assert.equal((await request('anonymous')).status, 401);
    assert.equal((await request('designer')).status, 403);
    assert.equal((await request('ungranted', [cid])).status, 403);
    assert.equal((await request('admin', [], '', '')).status, 400);
    assert.equal((await request('owner', [otherId])).status, 404);
    assert.equal((await request('owner', [publicId])).status, 404);
    assert.equal((await request('owner', [redactedId])).status, 404);
    assert.equal((await request('owner', [], '?from=invalid')).status, 422);
    assert.equal((await request('owner', [], '?beforeAt=2026-11-27T02%3A00%3A00.123456Z')).status, 422);

    const list = await data<ConsultationPage>(await request('owner'));
    assert.deepEqual(new Set(list.items.map(item => item.id)), new Set([cid, waitingId]));
    await withTenantTransaction(enterpriseId, async tx => {
      const ownerId = accounts.get('owner')!.id;
      assert.equal((await rows(tx, sql`select user_id from app.assistant_consultation_profiles(${ownerId}::bigint,${otherEnterprise}::bigint,null)`)).length, 0);
      assert.deepEqual((await rows(tx, sql`select user_id from app.assistant_consultation_profiles(${ownerId}::bigint,${enterpriseId}::bigint,null)`))
        .map(profile => String(profile.user_id)), [users[0]]);
      assert.equal((await one(tx, sql`select app.has_platform_access() as allowed`))?.allowed, false);
    });
    const filtered = await data<ConsultationPage>(await request('owner', [], '?' + new URLSearchParams({
      customer: '合成客户 main', reception: 'ai', from: '2026-11-27T02:00:00Z', to: '2026-11-27T03:00:00Z',
    })));
    assert.deepEqual(filtered.items.map(item => [item.id, item.customerName, item.reception]), [[cid, '合成客户 main', 'ai']]);
    assert.equal(filtered.items[0].updatedAt, '2026-11-27T02:00:00.123456Z');
    for (const name of ['admin', 'super_admin']) {
      assert.deepEqual((await data<ConsultationPage>(await request(name, [], '', otherEnterprise))).items.map(item => item.id), [otherId]);
      assert.equal((await request(name, [cid], '', otherEnterprise)).status, 404);
    }

    const first = await data<ConsultationDetail>(await request('owner', [cid]));
    assert.equal(first.record.reception, 'ai');
    assert.equal(first.messages.length, 20);
    assert.equal(first.messages.at(-1)?.text, '合成历史消息 22');
    assert.ok(first.nextCursor);
    const earlier = await data<ConsultationDetail>(await request('owner', [cid], `?beforeSeq=${first.nextCursor}`));
    assert.equal(earlier.nextCursor, null);
    assert.equal(earlier.messages[0].text, '客户发送了图片');
    assert.deepEqual(Object.keys(earlier.messages[0]).sort(), ['authorKind', 'createdAt', 'id', 'text']);
    assert.equal(earlier.messages.at(-1)?.text, '合成历史消息 2');
    const adminActor: ActorContext = { enterpriseId, principal: { kind: 'admin', adminId: accounts.get('owner')!.id },
      contextVersion: 0, capabilities: ['assistant.handoff.staff'] };
    await assert.rejects(new AssistantMediaService(adminActor).read(cid, uploaded.id), /assistant_resource_not_found/);
    await media.remove(cid, uploaded.id);
    const withdrawn = await data<ConsultationDetail>(await request('owner', [cid], `?beforeSeq=${first.nextCursor}`));
    assert.equal(withdrawn.messages[0].text, '图片已撤回或不可查看');

    const reads = await withTenantTransaction(enterpriseId, tx => rows(tx, sql`select actor_id,before_seq from app.assistant_consultation_reads
      where conversation_id=${cid} order by id`));
    assert.deepEqual(reads.map(read => [String(read.actor_id), read.before_seq === null ? null : String(read.before_seq)]),
      [null, first.nextCursor, first.nextCursor].map(cursor => [accounts.get('owner')!.id, cursor]));
    assert.equal((await withTenantTransaction(otherEnterprise, tx => rows(tx, sql`select id from app.assistant_consultation_reads`))).length, 0);
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set menu_permissions=ARRAY[]::text[] where id=${accounts.get('owner')!.id}`));
    assert.equal((await request('owner', [cid])).status, 403);
  } finally {
    try {
      await withPlatformTransaction(async tx => {
        for (const eid of enterprises) await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
        for (const userId of users) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
        for (const account of accounts.values()) await tx.execute(sql`update app.admin_users set must_change_password=true where id=${account.id}`);
      });
    } finally {
      await release();
      await closePostgresPool();
    }
  }
});
