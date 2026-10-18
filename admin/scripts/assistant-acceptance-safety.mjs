import pg from 'pg';

/** Hold one session lock for the whole suite, including its child processes. */
export async function lockAssistantAcceptance(databaseUrl = process.env.DATABASE_URL || '') {
  const url = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432'
    || url.pathname !== '/xiaok_embedding_eval') {
    throw new Error('Acceptance requires isolated loopback:55432/xiaok_embedding_eval; no migration or production switch is performed.');
  }
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const { rows: [role] } = await client.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
    if (role.rolsuper || role.rolbypassrls) throw new Error('Acceptance requires non-superuser, non-BYPASSRLS application role.');
    const { rows: [lock] } = await client.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) acquired");
    if (!lock.acquired) throw new Error('Another assistant acceptance run holds the isolated database lock.');
    const { rows: [schema] } = await client.query("select to_regclass('app.assistant_cost_reviews') present");
    if (!schema.present) throw new Error('Migration0062 is required; apply it separately to the isolated database.');
    await client.query('begin read only');
    try {
      await client.query("select set_config('app.is_platform_admin','true',true)");
      const { rows: [queue] } = await client.query("select count(*)::int active from app.assistant_jobs where status in ('queued','running')");
      if (queue.active) throw new Error('Acceptance requires an idle isolated queue; do not run standalone assistant suites or workers concurrently.');
    } finally { await client.query('rollback'); }
    return async () => { await client.end(); };
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}
