import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { privateSnapshot } from '@/lib/construction/camera/snapshot-retention';

after(closePostgresPool);
for (const preview of [false, true]) {
  test(`private snapshot authors stay readable with public-preview schema ${preview ? 'present' : 'absent'}`, async () => {
    const config = resolvePostgresRuntimeConfig();
    assert.equal(new URL(config.connectionString).pathname, '/cloud_camera_eval');
    // Transaction-local fixture only: no application-table DDL, migration,
    // recording-policy mutation or provider operation on the running soak.
    await withTenantTransaction('1454', async tx => {
      await tx.execute(sql`create temporary table camera_snapshot_scope_test(
        id integer primary key, actor_id bigint, actor_user_id bigint
        ${preview ? sql`, scheduled_live_version_id bigint` : sql``}
      ) on commit drop`);
      await tx.execute(sql`insert into camera_snapshot_scope_test(id,actor_id,actor_user_id) values(1,42,null),(2,null,43)`);
      if (preview) await tx.execute(sql`insert into camera_snapshot_scope_test(id,scheduled_live_version_id) values(3,99)`);
      assert.deepEqual((await rows(tx, sql`select s.id from camera_snapshot_scope_test s where ${privateSnapshot()} order by s.id`)).map(row => row.id), [1, 2]);
      if (preview) assert.equal((await rows(tx, sql`select s.id from camera_snapshot_scope_test s where s.id=3 and ${privateSnapshot()}`)).length, 0, 'direct private reads cannot expose a scheduled public cover');
    });
  });
}
