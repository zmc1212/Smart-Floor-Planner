import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { GET, POST } from '@/app/api/assistant/handoffs/[[...path]]/route';
import { AdminUserRepository } from '@/db/repositories';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { signAdminSession } from '@/lib/admin-session';
import { appendMessage, ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext, MessageContent } from '@/lib/assistant/contracts';
import { HandoffService } from '@/lib/assistant/handoff/service';
import { AssistantMediaService } from '@/lib/assistant/media/service';
import { closePostgresPool } from '@/lib/postgresql';
import { lockAssistantAcceptance } from '../../../scripts/assistant-acceptance-safety.mjs';
import { xiaokTestDatabase } from './xiaok-test-database';

const roles = ['enterprise_admin', 'admin', 'super_admin'] as const;
type Login = { id: string; token: string };
type Message = { id: string; seq: string; text: string; image?: { id: string; width: number; height: number } | null };
const textMessage = (text: string): MessageContent => ({ version: 1, blocks: [{ type: 'text', text }] });

test('Admin handoff shows authorized customer images in message order and rechecks withdrawal', async t => {
  const target = xiaokTestDatabase();
  const release = await lockAssistantAcceptance(target.href, { isolatedPort: target.port });
  const label = 'synthetic-handoff-images-' + randomUUID();
  const enterprises: string[] = [];
  const logins: Login[] = [];
  let userId: string | undefined;
  try {
    await withPlatformTransaction(async tx => {
      for (const suffix of ['primary', 'control']) {
        const row = (await one(tx, sql`insert into app.enterprises(name,code,status)
          values(${'合成接续图片 ' + suffix},${label + suffix},'active') returning id`))!;
        const enterpriseId = String(row.id);
        enterprises.push(enterpriseId);
        await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,retention_days)
          values(${enterpriseId},true,30)`);
      }
      userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${label},1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${label})`);
      for (const role of roles) {
        const row = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,menu_permissions)
          values(${role === 'enterprise_admin' ? enterprises[0] : null},${label + role},'unusable-synthetic',${role},'active',false,ARRAY['assistant-knowledge']) returning id`))!;
        const id = String(row.id);
        const admin = (await new AdminUserRepository(tx).findById(BigInt(id)))!;
        logins.push({ id, token: await signAdminSession({ admin, permissions: ['assistant-knowledge'] }) });
      }
    });

    const [enterpriseId, controlId] = enterprises;
    const customer: ActorContext = { enterpriseId, principal: { kind: 'user', userId: userId! }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
    const chat = new ConversationService(customer);
    const media = new AssistantMediaService(customer);
    const handoff = new HandoffService(customer);
    const cid = String((await chat.create(randomUUID())).id);
    const photo = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#aacdee' } }).png().toBuffer();
    const uploadedBefore = await media.upload(cid, randomUUID(), photo, 'image', '');
    const call = (login: Login, path: string[], action?: Row, selected = enterpriseId) => {
      const request = new NextRequest('http://localhost:3006/api/assistant/handoffs/' + path.join('/'), {
        method: action ? 'POST' : 'GET',
        headers: { Cookie: `auth_token=${login.token}; global_tenant_id=${selected}`, 'Idempotency-Key': randomUUID() },
        ...(action ? { body: JSON.stringify(action) } : {}),
      });
      return (action ? POST : GET)(request, { params: Promise.resolve({ path }) });
    };
    const detail = async (login: Login) => {
      const response = await call(login, [cid]);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data.messages as Message[];
    };
    assert.equal((await call(logins[0], [cid])).status, 404);
    await handoff.customerWrite(cid, randomUUID(), { action: 'request' });
    assert.deepEqual(await detail(logins[0]), []);
    assert.equal((await call(logins[0], [cid, 'media', uploadedBefore.id])).status, 404);

    await withTenantTransaction(enterpriseId, async tx => {
      for (let index = 0; index < 100; index++) {
        await appendMessage(tx, customer, cid, { author: 'user', content: textMessage(`合成历史消息 ${index + 1}`), purpose: 'handoff.supplement' });
      }
    });
    const beforeImage = await chat.send(cid, randomUUID(), textMessage('厨房的窗户在左边。'));
    const uploadedDuring = await media.upload(cid, randomUUID(), photo, 'image', '');
    const afterImage = await chat.send(cid, randomUUID(), textMessage('想把收纳做在图里的右手边。'));

    for (const [index, role] of roles.entries()) await t.test(`${role} can preview only during the active claim`, async () => {
      const login = logins[index];
      assert.equal((await call(login, [cid], { action: 'claim' })).status, 200);
      const messages = await detail(login);
      assert.equal(messages.length, 101);
      assert.deepEqual(messages.filter(m => m.image).map(m => m.image?.id), [uploadedBefore.id, uploadedDuring.id]);
      const position = messages.findIndex(m => m.image?.id === uploadedDuring.id);
      assert.equal(messages[position - 1].id, beforeImage.messageId);
      assert.equal(messages[position + 1].id, afterImage.messageId);

      const image = await call(login, [cid, 'media', uploadedDuring.id]);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await sharp(Buffer.from(await image.arrayBuffer())).metadata().then(({ width, height }) => ({ width, height })), { width: 80, height: 120 });
      const other = logins[(index + 1) % logins.length];
      assert.equal((await call(other, [cid])).status, 404);
      assert.equal((await call(other, [cid, 'media', uploadedDuring.id])).status, 404);

      const legacy = await new HandoffService({ enterpriseId, principal: { kind: 'admin', adminId: login.id },
        contextVersion: 0, capabilities: ['assistant.handoff.staff'] }).staffRead(cid);
      assert.equal(legacy.messages.length, 100);
      assert.equal(legacy.messages.some(m => 'image' in m), false);

      assert.equal((await call(login, [cid], { action: 'release' })).status, 200);
      assert.deepEqual(await detail(login), []);
      assert.equal((await call(login, [cid, 'media', uploadedDuring.id])).status, 404);
    });

    const login = logins[2];
    assert.equal((await call(login, [cid], { action: 'claim' })).status, 200);
    assert.equal((await call(login, [cid], undefined, controlId)).status, 404);
    assert.equal((await call(login, [cid, 'media', uploadedDuring.id], undefined, controlId)).status, 404);
    const imageMessageId = (await detail(login)).find(m => m.image?.id === uploadedDuring.id)!.id;
    await media.remove(cid, uploadedDuring.id);
    const refreshed = await detail(login);
    assert.equal(refreshed.find(m => m.id === imageMessageId)?.image, null);
    assert.equal(refreshed.find(m => m.image)?.image?.id, uploadedBefore.id);
    assert.equal((await call(login, [cid, 'media', uploadedDuring.id])).status, 404);
    await handoff.customerWrite(cid, randomUUID(), { action: 'cancel' });
    assert.equal((await call(login, [cid])).status, 404);
    assert.equal((await call(login, [cid, 'media', uploadedBefore.id])).status, 404);
  } finally {
    try {
      await withPlatformTransaction(async tx => {
        for (const enterpriseId of enterprises) await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
        for (const login of logins) await tx.execute(sql`update app.admin_users set must_change_password=true where id=${login.id}`);
        if (userId) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      });
    } finally {
      await release();
      await closePostgresPool();
    }
  }
});
