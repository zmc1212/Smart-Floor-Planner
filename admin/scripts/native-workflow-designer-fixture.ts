/** Development-only B5.6 designer receiver fixture.
 *
 * B-isolated, read/verify first, then a marked, idempotent fixture setup:
 * - designer admin 1454000011 (`b5-6-designer-1454`) linked to base Mini
 *   Program user 1454000011 (`b5-6-designer-user-1454`);
 * - designer project membership on the existing [B4] project 1454000004;
 * - outsider designer 1454000012 (`b5-6-outsider-1454`) linked to user
 *   1454000012, deliberately without project membership.
 *
 * The existing B4 fixture already owns enterprise 1454 and project 1454000004.
 * No followup binding is created here; the period CLI creates the
 * enterprise-scoped designer binding through the report service.
 *
 * No database target fallback, no model, no Worker and no DevTools.
 *
 * Usage (from admin/):
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/native-workflow-designer-fixture.ts --development
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
const DESIGNER_ADMIN_ID = '1454000011';
const DESIGNER_USER_ID = '1454000011';
const DESIGNER_ADMIN_USERNAME = `b5-6-designer-${ENTERPRISE_ID}`;
const DESIGNER_USERNAME = 'b5-6-designer-user-1454';
const DESIGNER_NICKNAME = '[B5.6] 设计师';
const DESIGNER_PHONE = '14500000011';
const OUTSIDER_ADMIN_ID = '1454000012';
const OUTSIDER_USER_ID = '1454000012';
const OUTSIDER_ADMIN_USERNAME = `b5-6-outsider-${ENTERPRISE_ID}`;
const OUTSIDER_USERNAME = 'b5-6-outsider-user-1454';
const OUTSIDER_NICKNAME = '[B5.6] 非项目设计师';
const OUTSIDER_PHONE = '14500000012';

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

    for (const fixture of [
      {
        label: 'designer',
        adminId: DESIGNER_ADMIN_ID,
        userId: DESIGNER_USER_ID,
        adminUsername: DESIGNER_ADMIN_USERNAME,
        username: DESIGNER_USERNAME,
        nickname: DESIGNER_NICKNAME,
        phone: DESIGNER_PHONE,
      },
      {
        label: 'outsider designer',
        adminId: OUTSIDER_ADMIN_ID,
        userId: OUTSIDER_USER_ID,
        adminUsername: OUTSIDER_ADMIN_USERNAME,
        username: OUTSIDER_USERNAME,
        nickname: OUTSIDER_NICKNAME,
        phone: OUTSIDER_PHONE,
      },
    ]) {
      const admin = (await client.query(
        `select id::text, enterprise_id::text, username, role, status, must_change_password, user_id::text
           from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
        [fixture.adminId, ENTERPRISE_ID],
      )).rows[0];
      if (admin) {
        if (admin.username !== fixture.adminUsername) {
          fail(
            `admin_users ${fixture.adminId} is already owned by ${JSON.stringify(admin.username)}; `
            + `refusing to overwrite it with the B5.6 marker ${JSON.stringify(fixture.adminUsername)}`,
          );
        }
        if (admin.role !== 'designer' || admin.status !== 'active' || admin.must_change_password !== false) {
          fail(`admin_users ${fixture.adminId} is not an active designer without a required password change`);
        }
        if (admin.user_id !== null && admin.user_id !== fixture.userId) {
          fail(
            `admin_users.user_id for ${fixture.adminId} is already linked to a foreign user ${admin.user_id}; `
            + 'refusing to change anything',
          );
        }
      }

      const existingUser = (await client.query(
        'select id::text, username from app.users where id=$1::bigint',
        [fixture.userId],
      )).rows[0];
      if (existingUser && existingUser.username !== fixture.username) {
        fail(
          `app.users ${fixture.userId} is already owned by ${JSON.stringify(existingUser.username)}; `
          + `refusing to overwrite it with the B5.6 marker ${fixture.username}`,
        );
      }
    }

    await client.query('begin');
    try {
      const prepared: Record<string, { contextVersion: number; mode: string; linkChange: string }> = {};
      for (const fixture of [
        {
          label: 'designer',
          adminId: DESIGNER_ADMIN_ID,
          userId: DESIGNER_USER_ID,
          adminUsername: DESIGNER_ADMIN_USERNAME,
          username: DESIGNER_USERNAME,
          nickname: DESIGNER_NICKNAME,
          phone: DESIGNER_PHONE,
        },
        {
          label: 'outsider designer',
          adminId: OUTSIDER_ADMIN_ID,
          userId: OUTSIDER_USER_ID,
          adminUsername: OUTSIDER_ADMIN_USERNAME,
          username: OUTSIDER_USERNAME,
          nickname: OUTSIDER_NICKNAME,
          phone: OUTSIDER_PHONE,
        },
      ]) {
        // Lock the admin row so a concurrent foreign link cannot appear between
        // the read-only check and the link update.
        const locked = (await client.query<{ user_id: string | null }>(
          'select user_id::text from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint for update',
          [fixture.adminId, ENTERPRISE_ID],
        )).rows[0];
        if (locked && locked.user_id !== null && locked.user_id !== fixture.userId) {
          fail(`admin_users.user_id became foreign (${locked.user_id}); rolled back without changes`);
        }

        if (!adminExists(await client.query('select 1 from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint', [fixture.adminId, ENTERPRISE_ID]))) {
          await client.query(
            `insert into app.admin_users(id,enterprise_id,username,password_hash,display_name,role,status,must_change_password)
             overriding system value
             values($1::bigint,$2::bigint,$3,'unusable-synthetic-fixture',$4,'designer','active',false)`,
            [fixture.adminId, ENTERPRISE_ID, fixture.adminUsername, fixture.nickname],
          );
        }

        const preparedUser = await prepareWorkerUser(client, {
          userId: fixture.userId,
          enterpriseId: ENTERPRISE_ID,
          username: fixture.username,
          nickname: fixture.nickname,
          phone: fixture.phone,
        });

        let linkChange = 'unchanged';
        if (locked === undefined || locked.user_id === null) {
          const linked = await client.query(
            'update app.admin_users set user_id=$1::bigint, updated_at=now() where id=$2::bigint and enterprise_id=$3::bigint and user_id is null',
            [fixture.userId, fixture.adminId, ENTERPRISE_ID],
          );
          linkChange = linked.rowCount === 1 ? 'linked' : 'unchanged';
        }
        prepared[fixture.label] = {
          contextVersion: preparedUser.contextVersion,
          mode: preparedUser.mode,
          linkChange,
        };

        await client.query(
          `select setval(pg_get_serial_sequence('app.users','id')::regclass,
             greatest((select coalesce(max(id),0) from app.users), $1::bigint))`,
          [fixture.userId],
        );
        await client.query(
          `select setval(pg_get_serial_sequence('app.admin_users','id')::regclass,
             greatest((select coalesce(max(id),0) from app.admin_users), $1::bigint))`,
          [fixture.adminId],
        );
      }

      // The designer is an active member of the fixed project; the outsider is
      // deliberately not a member so the receiver check can be exercised.
      await client.query(
        `insert into app.construction_members(enterprise_id,project_id,admin_id,role,active,work_label)
         values($1::bigint,$2::bigint,$3::bigint,'designer',true,'')
         on conflict(enterprise_id,project_id,admin_id)
         do update set role='designer', active=true, work_label=''`,
        [ENTERPRISE_ID, PROJECT_ID, DESIGNER_ADMIN_ID],
      );
      await client.query(
        'delete from app.construction_members where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint',
        [ENTERPRISE_ID, PROJECT_ID, OUTSIDER_ADMIN_ID],
      );
      await client.query('commit');

      // Read back exact rows after the marked setup.
      const readBack = async (adminId: string, userId: string) => {
        const user = (await client.query(
          'select id::text, enterprise_id::text, username, nickname, role, phone, context_version from app.users where id=$1::bigint',
          [userId],
        )).rows[0];
        const admin = (await client.query(
          `select id::text, enterprise_id::text, username, role, status, must_change_password, user_id::text
             from app.admin_users where id=$1::bigint and enterprise_id=$2::bigint`,
          [adminId, ENTERPRISE_ID],
        )).rows[0];
        const member = (await client.query(
          `select enterprise_id::text, project_id::text, admin_id::text, role, active
             from app.construction_members
            where enterprise_id=$1::bigint and project_id=$2::bigint and admin_id=$3::bigint`,
          [ENTERPRISE_ID, PROJECT_ID, adminId],
        )).rows[0];
        return { user, admin, member: member ?? null };
      };

      const designer = await readBack(DESIGNER_ADMIN_ID, DESIGNER_USER_ID);
      const outsider = await readBack(OUTSIDER_ADMIN_ID, OUTSIDER_USER_ID);
      if (!designer.user || designer.user.username !== DESIGNER_USERNAME
        || designer.user.nickname !== DESIGNER_NICKNAME || designer.user.role !== 'user'
        || rowText(designer.user.phone) !== DESIGNER_PHONE) {
        fail('designer base user read-back mismatch after the fixture write');
      }
      if (!designer.admin || designer.admin.user_id !== DESIGNER_USER_ID
        || designer.admin.role !== 'designer') {
        fail('designer admin read-back mismatch after the fixture write');
      }
      if (!designer.member || designer.member.active !== true || designer.member.role !== 'designer') {
        fail('designer membership read-back mismatch after the fixture write');
      }
      if (!outsider.user || outsider.user.username !== OUTSIDER_USERNAME
        || !outsider.admin || outsider.admin.user_id !== OUTSIDER_USER_ID) {
        fail('outsider designer read-back mismatch after the fixture write');
      }
      if (outsider.member) fail('the outsider designer must not have a project membership');

      const designerContextVersion = parseContextVersion(
        designer.user.context_version,
        'designer base user context_version',
      );
      const outsiderContextVersion = parseContextVersion(
        outsider.user.context_version,
        'outsider base user context_version',
      );

      console.log(JSON.stringify({
        success: true,
        database: describeB4DatabaseTarget(target),
        enterprise: { id: rowText(enterprise.id), code: enterprise.code, name: enterprise.name, status: enterprise.status },
        project: { id: rowText(project.id), name: project.name, status: project.status },
        designer: {
          adminId: rowText(designer.admin.id),
          adminUsername: designer.admin.username,
          role: designer.admin.role,
          status: designer.admin.status,
          mustChangePassword: designer.admin.must_change_password,
          userId: rowText(designer.admin.user_id),
          userUsername: designer.user.username,
          nickname: designer.user.nickname,
          contextVersion: designerContextVersion,
          memberRole: designer.member.role,
          memberActive: designer.member.active,
          prepared: prepared.designer,
        },
        outsider: {
          adminId: rowText(outsider.admin.id),
          adminUsername: outsider.admin.username,
          role: outsider.admin.role,
          userId: rowText(outsider.admin.user_id),
          userUsername: outsider.user.username,
          contextVersion: outsiderContextVersion,
          member: outsider.member,
          prepared: prepared['outsider designer'],
        },
        designerBindingCreated: false,
        bindingNote: 'no binding is created here; the period CLI creates the enterprise-scoped designer binding',
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

function adminExists(result: { rows: unknown[] }): boolean {
  return result.rows.length > 0;
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: messageOf(error) }, null, 2));
  process.exitCode = 1;
});
