/** Development-only B5.7 boss (enterprise owner) receiver fixture.
 *
 * B-isolated, read/verify first, then a marked, idempotent fixture setup:
 * - boss admin 1454000013 (`b5-7-boss-1454`, role `enterprise_admin`) linked
 *   to base Mini Program user 1454000013 (`b5-7-boss-user-1454`);
 * - deliberately no `construction_members` row, so the acceptance proves the
 *   existing owner/followup rule rather than a project membership.
 *
 * The existing B4 fixture already owns enterprise 1454 and project 1454000004.
 * No followup binding is created here; the period CLI creates the
 * enterprise-scoped boss binding through the report service.
 *
 * No database target fallback, no model, no Worker and no DevTools.
 *
 * Usage (from admin/):
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/native-workflow-boss-fixture.ts --development
 */
import pg from 'pg';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';
import {
  parseContextVersion,
  prepareWorkerUser,
} from '@/lib/native-workflow/live/worker-fixture';

const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';
const BOSS_ADMIN_ID = '1454000013';
const BOSS_USER_ID = '1454000013';
const BOSS_ADMIN_USERNAME = `b5-7-boss-${ENTERPRISE_ID}`;
const BOSS_USERNAME = 'b5-7-boss-user-1454';
const BOSS_NICKNAME = '[B5.7] 老板';
const BOSS_PHONE = '14500000013';

function fail(message: string): never {
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exit(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

const target = (() => {
  try {
    return resolveB4DatabaseTarget({ purpose: 'fixture' });
  } catch (error) {
    return fail(messageOf(error));
  }
})();

async function main(): Promise<void> {
  console.log(`Fixture database: ${describeB4DatabaseTarget(target)}`);
  const pool = new pg.Pool({ connectionString: target.url, max: 1 });
  const client = await pool.connect();
  try {
    const identity = await client.query<{ database: string; username: string }>(
      'select current_database() as database, current_user as username',
    );
    const connected = identity.rows[0];
    if (!connected) fail('PostgreSQL did not return the connection identity.');
    assertB4ConnectionIdentity(target, connected);

    // Read-only ownership/identity checks before any write.
    const enterprise = (await client.query(
      'select id::text, code, name, status from app.enterprises where id=$1::bigint',
      [ENTERPRISE_ID],
    )).rows[0];
    if (!enterprise
      || String(enterprise.id) !== ENTERPRISE_ID
      || enterprise.status !== 'active'
      || !String(enterprise.name ?? '').startsWith('[B4]')) {
      fail('fixture enterprise mismatch: expected the active [B4] enterprise 1454; run the B4 fixture first');
    }

    const project = (await client.query(
      'select id::text, enterprise_id::text, name, status from app.construction_projects where id=$1::bigint and enterprise_id=$2::bigint',
      [PROJECT_ID, ENTERPRISE_ID],
    )).rows[0];
    if (!project || project.status !== 'active') {
      fail('fixture project mismatch: expected active project 1454000004 in enterprise 1454');
    }

    const admin = (await client.query(
      `select id::text, enterprise_id::text, username, role, status, must_change_password, user_id::text
         from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
      [BOSS_ADMIN_ID, ENTERPRISE_ID],
    )).rows[0];
    if (admin) {
      if (admin.username !== BOSS_ADMIN_USERNAME) {
        fail(
          `admin_users ${BOSS_ADMIN_ID} is already owned by ${JSON.stringify(admin.username)}; `
          + `refusing to overwrite it with the B5.7 marker ${JSON.stringify(BOSS_ADMIN_USERNAME)}`,
        );
      }
      if (admin.role !== 'enterprise_admin' || admin.status !== 'active' || admin.must_change_password !== false) {
        fail(`admin_users ${BOSS_ADMIN_ID} is not an active enterprise_admin without a required password change`);
      }
      if (admin.user_id !== null && admin.user_id !== BOSS_USER_ID) {
        fail(
          `admin_users.user_id for ${BOSS_ADMIN_ID} is already linked to a foreign user ${admin.user_id}; `
          + 'refusing to change anything',
        );
      }
    }

    const existingUser = (await client.query(
      'select id::text, username from app.users where id=$1::bigint',
      [BOSS_USER_ID],
    )).rows[0];
    if (existingUser && existingUser.username !== BOSS_USERNAME) {
      fail(
        `app.users ${BOSS_USER_ID} is already owned by ${JSON.stringify(existingUser.username)}; `
        + `refusing to overwrite it with the B5.7 marker ${BOSS_USERNAME}`,
      );
    }

    await client.query('begin');
    try {
      // Lock the admin row so a concurrent foreign link cannot appear between
      // the read-only check and the link update.
      const locked = (await client.query<{ user_id: string | null }>(
        'select user_id::text from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint for update',
        [BOSS_ADMIN_ID, ENTERPRISE_ID],
      )).rows[0];
      if (locked && locked.user_id !== null && locked.user_id !== BOSS_USER_ID) {
        fail(`admin_users.user_id became foreign (${locked.user_id}); rolled back without changes`);
      }

      if (!admin) {
        await client.query(
          `insert into app.admin_users(id,enterprise_id,username,password_hash,display_name,role,status,must_change_password)
           overriding system value
           values($1::bigint,$2::bigint,$3,'unusable-synthetic-fixture',$4,'enterprise_admin','active',false)`,
          [BOSS_ADMIN_ID, ENTERPRISE_ID, BOSS_ADMIN_USERNAME, BOSS_NICKNAME],
        );
      }

      const preparedUser = await prepareWorkerUser(client, {
        userId: BOSS_USER_ID,
        enterpriseId: ENTERPRISE_ID,
        username: BOSS_USERNAME,
        nickname: BOSS_NICKNAME,
        phone: BOSS_PHONE,
      });

      let linkChange = 'unchanged';
      if (locked === undefined || locked.user_id === null) {
        const linked = await client.query(
          'update app.admin_users set user_id=$1::bigint, updated_at=now() where id=$2::bigint and enterprise_id=$3::bigint and user_id is null',
          [BOSS_USER_ID, BOSS_ADMIN_ID, ENTERPRISE_ID],
        );
        linkChange = linked.rowCount === 1 ? 'linked' : 'unchanged';
      }

      // A boss is the enterprise owner, never a project member. Remove any
      // stale membership row so the acceptance cannot pass via membership.
      await client.query(
        'delete from app.construction_members where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint',
        [ENTERPRISE_ID, PROJECT_ID, BOSS_ADMIN_ID],
      );

      await client.query(
        `select setval(pg_get_serial_sequence('app.users','id')::regclass,
           greatest((select coalesce(max(id),0) from app.users), $1::bigint))`,
        [BOSS_USER_ID],
      );
      await client.query(
        `select setval(pg_get_serial_sequence('app.admin_users','id')::regclass,
           greatest((select coalesce(max(id),0) from app.admin_users), $1::bigint))`,
        [BOSS_ADMIN_ID],
      );
      await client.query('commit');

      // Read back exact rows after the marked setup.
      const user = (await client.query(
        'select id::text, enterprise_id::text, username, nickname, role, phone, context_version from app.users where id=$1::bigint',
        [BOSS_USER_ID],
      )).rows[0];
      const readAdmin = (await client.query(
        `select id::text, enterprise_id::text, username, role, status, must_change_password, user_id::text
           from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
        [BOSS_ADMIN_ID, ENTERPRISE_ID],
      )).rows[0];
      const member = (await client.query(
        `select enterprise_id::text, project_id::text, admin_id::text, role, active
           from app.construction_members
          where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
        [ENTERPRISE_ID, PROJECT_ID, BOSS_ADMIN_ID],
      )).rows[0];

      if (!user || user.username !== BOSS_USERNAME || user.nickname !== BOSS_NICKNAME
        || user.role !== 'user' || rowText(user.phone) !== BOSS_PHONE) {
        fail('boss base user read-back mismatch after the fixture write');
      }
      if (!readAdmin || readAdmin.user_id !== BOSS_USER_ID || readAdmin.role !== 'enterprise_admin'
        || readAdmin.status !== 'active' || readAdmin.must_change_password !== false) {
        fail('boss admin read-back mismatch after the fixture write');
      }
      if (member) fail('the boss must not have a project membership row');

      const contextVersion = parseContextVersion(user.context_version, 'boss base user context_version');

      console.log(JSON.stringify({
        success: true,
        database: describeB4DatabaseTarget(target),
        enterprise: { id: rowText(enterprise.id), code: enterprise.code, name: enterprise.name, status: enterprise.status },
        project: { id: rowText(project.id), name: project.name, status: project.status },
        boss: {
          adminId: rowText(readAdmin.id),
          adminUsername: readAdmin.username,
          role: readAdmin.role,
          status: readAdmin.status,
          mustChangePassword: readAdmin.must_change_password,
          userId: rowText(readAdmin.user_id),
          userUsername: user.username,
          nickname: user.nickname,
          contextVersion,
          member: null,
          prepared: { contextVersion: preparedUser.contextVersion, mode: preparedUser.mode, linkChange },
        },
        bossBindingCreated: false,
        bindingNote: 'no binding is created here; the period CLI creates the enterprise-scoped boss binding',
      }, null, 2));
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: messageOf(error) }, null, 2));
  process.exitCode = 1;
});
