/** Development-only B5.5 worker receiver fixture.
 *
 * B-isolated, read/verify first, then a marked, idempotent fixture setup:
 * - base Mini Program user 1454000008 (`b5-5-worker-user-1454`) so the worker
 *   admin has a real staff identity context;
 * - `admin_users.user_id` links the existing worker admin to that base user
 *   only when the link is null or already correct.
 *
 * The existing B4 fixture already owns enterprise 1454, project 1454000004 and
 * worker admin 1454000008; this script never creates a project-scoped worker
 * followup binding. The persistent fixture is not deleted or restored.
 *
 * No database target fallback, no model, no Worker and no DevTools.
 *
 * Usage (from admin/):
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/native-workflow-worker-fixture.ts --development
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
const WORKER_ADMIN_ID = '1454000008';
const WORKER_USER_ID = '1454000008';
const WORKER_USERNAME = 'b5-5-worker-user-1454';
const WORKER_NICKNAME = '[B5.5] 施工工人';
const WORKER_PHONE = '14500000008';
const WORKER_ADMIN_USERNAME = `b4-live-worker-${ENTERPRISE_ID}`;

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
      [WORKER_ADMIN_ID, ENTERPRISE_ID],
    )).rows[0];
    if (!admin
      || String(admin.id) !== WORKER_ADMIN_ID
      || admin.username !== WORKER_ADMIN_USERNAME
      || admin.role !== 'construction_staff'
      || admin.status !== 'active'
      || admin.must_change_password !== false) {
      fail(`fixture worker admin mismatch: expected active construction_staff ${WORKER_ADMIN_USERNAME} (id ${WORKER_ADMIN_ID})`);
    }

    const member = (await client.query(
      `select enterprise_id::text, project_id::text, admin_id::text, role, active
         from app.construction_members
        where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
      [ENTERPRISE_ID, PROJECT_ID, WORKER_ADMIN_ID],
    )).rows[0];
    if (!member || member.active !== true || member.role !== 'worker') {
      fail(`fixture worker membership mismatch: expected an active worker member row on project ${PROJECT_ID}`);
    }

    if (admin.user_id !== null && admin.user_id !== WORKER_USER_ID) {
      fail(
        `admin_users.user_id for worker ${WORKER_ADMIN_ID} is already linked to a foreign user ${admin.user_id}; `
        + 'refusing to change anything',
      );
    }

    const existingUser = (await client.query(
      'select id::text, enterprise_id::text, username, nickname, role, phone, context_version from app.users where id=$1::bigint',
      [WORKER_USER_ID],
    )).rows[0];
    if (existingUser && existingUser.username !== WORKER_USERNAME) {
      fail(
        `app.users ${WORKER_USER_ID} is already owned by ${JSON.stringify(existingUser.username)}; `
        + `refusing to overwrite it with the B5.5 marker ${WORKER_USERNAME}`,
      );
    }

    let linkChange = 'unchanged';
    let preparedContextVersion: number | null = null;
    await client.query('begin');
    try {
      // Lock the admin row so a concurrent foreign link cannot appear between
      // the read-only check and the link update.
      const locked = (await client.query<{ user_id: string | null }>(
        'select user_id::text from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint for update',
        [WORKER_ADMIN_ID, ENTERPRISE_ID],
      )).rows[0];
      if (!locked) fail('the worker admin row disappeared before the fixture write');
      if (locked.user_id !== null && locked.user_id !== WORKER_USER_ID) {
        fail(`admin_users.user_id became foreign (${locked.user_id}); rolled back without changes`);
      }

      const prepared = await prepareWorkerUser(client, {
        userId: WORKER_USER_ID,
        enterpriseId: ENTERPRISE_ID,
        username: WORKER_USERNAME,
        nickname: WORKER_NICKNAME,
        phone: WORKER_PHONE,
      });
      preparedContextVersion = prepared.contextVersion;

      if (locked.user_id === null) {
        await client.query(
          'update app.admin_users set user_id=$1::bigint, updated_at=now() where id=$2::bigint and enterprise_id=$3::bigint',
          [WORKER_USER_ID, WORKER_ADMIN_ID, ENTERPRISE_ID],
        );
        linkChange = 'linked';
      }

      await client.query(
        `select setval(pg_get_serial_sequence('app.users','id')::regclass,
           greatest((select coalesce(max(id),0) from app.users), $1::bigint))`,
        [WORKER_USER_ID],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }

    // Read back exact rows after the marked setup.
    const user = (await client.query(
      'select id::text, enterprise_id::text, username, nickname, role, phone, context_version from app.users where id=$1::bigint',
      [WORKER_USER_ID],
    )).rows[0];
    const linkedAdmin = (await client.query(
      `select id::text, enterprise_id::text, username, role, status, must_change_password, user_id::text
         from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
      [WORKER_ADMIN_ID, ENTERPRISE_ID],
    )).rows[0];
    const bindings = (await client.query(
      `select id::text, principal_key, audience, project_id::text, scope_key, status,
              conversation_id::text, user_id::text, admin_id::text
         from app.construction_followup_bindings
        where enterprise_id=$1::bigint and principal_key=$2 and audience='worker'
        order by id`,
      [ENTERPRISE_ID, `admin:${WORKER_ADMIN_ID}`],
    )).rows;

    if (preparedContextVersion === null) {
      fail('base user was not prepared before the fixture read-back');
    }
    if (!user
      || String(user.id) !== WORKER_USER_ID
      || user.username !== WORKER_USERNAME
      || user.nickname !== WORKER_NICKNAME
      || user.role !== 'user'
      || rowText(user.phone) !== WORKER_PHONE) {
      fail('base user read-back mismatch after the fixture write');
    }
    const readBackContextVersion = parseContextVersion(
      user.context_version,
      `app.users ${WORKER_USER_ID} context_version after the fixture write`,
    );
    if (readBackContextVersion !== preparedContextVersion) {
      fail('base user context_version read-back mismatch after the fixture write');
    }
    if (!linkedAdmin || linkedAdmin.user_id !== WORKER_USER_ID) {
      fail('admin_users.user_id read-back mismatch after the fixture write');
    }

    console.log(JSON.stringify({
      success: true,
      database: describeB4DatabaseTarget(target),
      enterprise: {
        id: rowText(enterprise.id),
        code: enterprise.code,
        name: enterprise.name,
        status: enterprise.status,
      },
      project: { id: rowText(project.id), name: project.name, status: project.status },
      workerAdmin: {
        id: rowText(linkedAdmin.id),
        username: linkedAdmin.username,
        role: linkedAdmin.role,
        status: linkedAdmin.status,
        mustChangePassword: linkedAdmin.must_change_password,
        userId: rowText(linkedAdmin.user_id),
        linkChange,
      },
      workerUser: {
        id: rowText(user.id),
        enterpriseId: rowText(user.enterprise_id),
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        phone: rowText(user.phone),
        contextVersion: readBackContextVersion,
      },
      workerMember: {
        enterpriseId: rowText(member.enterprise_id),
        projectId: rowText(member.project_id),
        adminId: rowText(member.admin_id),
        role: member.role,
        active: member.active,
      },
      workerBindings: bindings.map((binding) => ({
        id: rowText(binding.id),
        principalKey: binding.principal_key,
        audience: binding.audience,
        projectId: rowText(binding.project_id),
        scopeKey: binding.scope_key,
        status: binding.status,
        conversationId: rowText(binding.conversation_id),
        userId: rowText(binding.user_id),
        adminId: rowText(binding.admin_id),
      })),
      workerBindingCreated: false,
      bindingNote: bindings.length
        ? 'existing worker binding reported; no binding was created or changed'
        : 'no worker binding yet; the period CLI creates the enterprise-scoped binding',
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: messageOf(error) }, null, 2));
  process.exitCode = 1;
});
