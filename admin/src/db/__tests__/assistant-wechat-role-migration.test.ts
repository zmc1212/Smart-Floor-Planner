import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '../transaction';
import { rows } from '../repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { xiaokTestDatabase } from './xiaok-test-database';

/**
 * The role-recipient migration is intentionally exercised against the same
 * disposable database used by the main-channel acceptance. The transaction is
 * rolled back so this check leaves no synthetic user, channel, or event.
 */
test('主小K角色收件绑定允许企业范围并按企业隔离事件去重', { skip: !process.env.XIAOK_MAIN_WECHAT_FIXTURE }, async t => {
  xiaokTestDatabase();
  t.after(closePostgresPool);
  const rollback = new Error('role recipient migration rollback');
  await assert.rejects(withPlatformTransaction(async tx => {
    const enterprises = await rows<{ id: string }>(tx, sql`select id::text as id from app.enterprises where id in (1454,1455) order by id`);
    assert.deepEqual(enterprises.map(row => row.id), ['1454', '1455']);
    const suffix = randomUUID().slice(0, 8);
    const users = await rows<{ id: string; enterprise_id: string }>(tx, sql`
      insert into app.users(enterprise_id,nickname,role)
      values (1454,${'角色迁移业主-' + suffix},'user'),(1455,${'角色迁移对照-' + suffix},'user')
      returning id::text as id,enterprise_id::text as enterprise_id`);
    const channelIds: string[] = [];
    for (const user of users) {
      const channel = (await rows<{ id: string }>(tx, sql`
        insert into app.assistant_wechat_channels
          (enterprise_id,stage_id,status,login_state,qr_secret,expires_at,api_origin,
           recipient_key,mini_user_id,identity_version,recipient_audience)
        values (${user.enterprise_id},'main','pending','wait','synthetic',now()+interval '15 minutes',
          'https://example.test','user:' || ${user.id},${user.id},1,'customer')
        returning id::text as id`))[0];
      assert.ok(channel?.id);
      channelIds.push(channel.id);
    }
    await tx.execute(sql`
      insert into app.assistant_wechat_events
        (enterprise_id,channel_id,event_key,role_delivery_key)
      values (1454,${channelIds[0]},${'role-event-' + suffix},${'role-daily-' + suffix})`);
    const duplicate = await rows(tx, sql`
        insert into app.assistant_wechat_events
          (enterprise_id,channel_id,event_key,role_delivery_key)
        values (1454,${channelIds[0]},${'role-event-duplicate-' + suffix},${'role-daily-' + suffix})
        on conflict do nothing returning id`);
    assert.deepEqual(duplicate, []);
    await tx.execute(sql`
      insert into app.assistant_wechat_events
        (enterprise_id,channel_id,event_key,role_delivery_key)
      values (1455,${channelIds[1]},${'role-event-control-' + suffix},${'role-daily-' + suffix})`);
    await tx.execute(sql`savepoint invalid_legacy_scope`);
    await assert.rejects(tx.execute(sql`update app.assistant_wechat_channels set recipient_audience=null where id=${channelIds[0]}`),
      error => (error as { cause?: { code?: string } }).cause?.code === '23514');
    await tx.execute(sql`rollback to savepoint invalid_legacy_scope`);
    throw rollback;
  }), error => error === rollback);
});
