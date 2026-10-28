import pg from 'pg';

/** Hold one session lock for the whole suite, including its child processes.
 * @param {string} [databaseUrl]
 * @param {{waitForLock?: boolean, onLockError?: (error: Error) => void}} [options]
 */
export async function lockAssistantAcceptance(databaseUrl = process.env.DATABASE_URL || '', { waitForLock = false, onLockError } = {}) {
  const url = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432'
    || url.pathname !== '/xiaok_embedding_eval') {
    throw new Error('Acceptance requires isolated loopback:55432/xiaok_embedding_eval; no migration or production switch is performed.');
  }
  const client = new pg.Client({ connectionString: url.toString(), keepAlive: true, keepAliveInitialDelayMillis: 10000 });
  let lostError, heartbeat, checking = false;
  const lost = error => { lostError ||= error; onLockError?.(error); };
  if (onLockError) client.on('error', lost);
  try {
    await client.connect();
    const assertRole = async () => {
      const { rows: [role] } = await client.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
      if (role.rolsuper || role.rolbypassrls) throw new Error('Acceptance requires non-superuser, non-BYPASSRLS application role.');
    };
    await assertRole();
    if (waitForLock) {
      // Opt-in server-side queuing preserves the same exclusive session lock.
      // Role/target checks above and idle-queue validation below still apply.
      await client.query("select set_config('lock_timeout','15min',false)");
      await client.query("select pg_advisory_lock(hashtext('assistant_isolated_acceptance'))");
      await assertRole();
    } else {
      const { rows: [lock] } = await client.query("select pg_try_advisory_lock(hashtext('assistant_isolated_acceptance')) acquired");
      if (!lock.acquired) throw new Error('Another assistant acceptance run holds the isolated database lock.');
    }
    const { rows: [schema] } = await client.query("select to_regclass('app.assistant_cost_reviews') present");
    if (!schema.present) throw new Error('Migration0062 is required; apply it separately to the isolated database.');
    await client.query('begin read only');
    try {
      await client.query("select set_config('app.is_platform_admin','true',true)");
      const { rows: [queue] } = await client.query("select count(*)::int active from app.assistant_jobs where status in ('queued','running')");
      if (queue.active) throw new Error('Acceptance requires an idle isolated queue; do not run standalone assistant suites or workers concurrently.');
    } finally { await client.query('rollback'); }
    const assertHeld = async () => {
      if (lostError) throw lostError;
      // A Client never reconnects: success verifies the same lock-owning session.
      try { await client.query({ text: 'select 1', query_timeout: 5000 }); }
      catch (error) { lost(error); throw error; }
    };
    if (onLockError) {
      heartbeat = setInterval(async () => { if (checking || lostError) return; checking = true;
        try { await assertHeld(); } catch { /* Caller fences dispatch and cleans up. */ }
        finally { checking = false; } }, 20000);
      heartbeat.unref();
    }
    const release = async () => { clearInterval(heartbeat); await client.end(); };
    release.assertHeld = assertHeld;
    return release;
  } catch (error) {
    clearInterval(heartbeat);
    await client.end().catch(() => {});
    throw error;
  }
}
