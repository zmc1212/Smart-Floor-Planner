/** B5.1 development acceptance: the existing B stage-reminder entry, read
 * through the original XiaoK customer API.
 *
 * It uses the labelled B fixture (enterprise 1454) in the isolated database on
 * 127.0.0.1:55433. It does not call a model, FastGPT, embedding or enterprise
 * knowledge; the legacy report schedule is explicitly disabled by the fixture.
 *
 * Usage (from admin/, after `npx tsx scripts/native-workflow-live-fixture.ts --development`):
 *   $env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
 *   $env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
 *   npx tsx scripts/native-workflow-stage-reminder-user-loop.ts --development
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { withTenantTransaction } from '@/db/transaction';
import { closePostgresPool } from '@/lib/postgresql';
import { publishAcceptanceDefinition } from '@/lib/native-workflow/live/acceptance-store';
import {
  cleanupAcceptanceConversation,
  createAcceptanceConversation,
} from '@/lib/native-workflow/live/acceptance-conversation';
import {
  assertB4ConnectionIdentity,
  describeB4DatabaseTarget,
  resolveB4DatabaseTarget,
} from '@/lib/native-workflow/live/dev-config';

const ENTERPRISE_ID = '1454';
const ADMIN_ID = '1454000001';
const CUSTOMER_USER_ID = '1454000002';
const LEAD_ID = '1454000003';
const PROJECT_ID = '1454000004';
const CONVERSATION_ID = '1454000005';
const CUSTOMER_OPENID = `b4-live-openid-${ENTERPRISE_ID}`;
const STAGE_KEY = 'plumbing';
const STAGE_LABEL = '水路';

function fail(message: string): never {
  console.error(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

if (!process.argv.includes('--development')) fail('--development is required');
if (process.env.NODE_ENV === 'production') fail('refusing to run in production');

const appTarget = resolveB4DatabaseTarget({ purpose: 'app' });
const fixtureTarget = resolveB4DatabaseTarget({ purpose: 'fixture' });
const runStamp = new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 17);
const runId = `b5-1-user-loop-${runStamp}`;
const eventId = `b5-1-event-${runStamp}`;
// The acceptance owns two dedicated, per-run directories. Both are placed in
// the environment before any store module is imported or any CLI is spawned,
// so neither the parent nor a subprocess can read the normal B store.
const acceptanceStoreDir = path.resolve('tmp/b5-1-acceptance-store', runId);
const acceptanceRunDir = path.resolve('tmp/b5-1-acceptance-runs', runId);
process.env.NATIVE_WORKFLOW_STORE_DIR = acceptanceStoreDir;
process.env.NATIVE_WORKFLOW_RUN_DIR = acceptanceRunDir;
const outputDir = acceptanceRunDir;
const verificationFile = path.join(outputDir, 'verification.json');
const normalStoreFile = path.resolve('tmp/native-workflow-store/stage-reminder.json');
// Per-run ids above the shared fixture conversation (1454000005) and strictly
// below the integration suite range (1454900003+). The runner clock keeps them
// distinct per millisecond; an occupied id aborts instead of being reused.
const runNumber = Number(runStamp.slice(-6)) % 100_000;
const crossConversationId = String(1454800000 + runNumber);
const crossParticipantId = String(1454800001 + runNumber);
for (const id of [crossConversationId, crossParticipantId]) {
  assert.ok(
    Number(id) > Number(CONVERSATION_ID) && Number(id) < 1454900003,
    `acceptance id ${id} must sit between the shared fixture and the integration suite`,
  );
}

function snapshotFile(file: string): Row {
  if (!fs.existsSync(file)) return { exists: false, bytes: 0, sha256: null };
  const bytes = fs.readFileSync(file);
  return { exists: true, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const normalStoreBefore = snapshotFile(normalStoreFile);
const evidence: Row = {
  startedAt: new Date().toISOString(),
  runId,
  eventId,
  acceptancePaths: { storeDir: acceptanceStoreDir, runDir: acceptanceRunDir },
  acceptanceIds: { conversationId: crossConversationId, participantId: crossParticipantId },
  normalStore: { file: normalStoreFile, before: normalStoreBefore },
  database: { app: describeB4DatabaseTarget(appTarget), fixture: describeB4DatabaseTarget(fixtureTarget) },
  checks: [],
  failures: [],
};

function save(): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(verificationFile, `${JSON.stringify(evidence, null, 2)}\n`);
}

function check(name: string, passed: boolean, detail: Row = {}): void {
  (evidence.checks as Row[]).push({ name, passed, ...detail });
  if (!passed) (evidence.failures as Row[]).push({ name, ...detail });
  save();
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    check(name, false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** A cleanup that ran must confirm every owned row; `ran: false` means there was
 * nothing to remove because this run never created the temporary rows. */
function cleanupIncomplete(result: Row): boolean {
  return result.ran === true
    && (result.completed !== true || Number(result.skipped ?? 0) > 0);
}

function ownerPool(): pg.Pool {
  return new pg.Pool({ connectionString: fixtureTarget.url, max: 2 });
}

async function counter(pool: pg.Pool, table: string, where = 'true'): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table} where ${where}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function usageSnapshot(pool: pg.Pool): Promise<Row> {
  return {
    assistantUsageRecords: await counter(pool, 'app.assistant_usage_records'),
    aiProviderAttempts: await counter(pool, 'app.ai_provider_attempts'),
    assistantKnowledgeAttempts: await counter(pool, 'app.assistant_knowledge_attempts'),
    assistantJobs: await counter(pool, 'app.assistant_jobs'),
    assistantRuns: await counter(pool, 'app.assistant_runs'),
    constructionReports: await counter(pool, 'app.construction_reports'),
    reportDeliveries: await counter(pool, 'app.construction_report_deliveries'),
    reportEvents: await counter(pool, 'app.domain_event_outbox', "type like 'construction.report.%'"),
  };
}

async function preflight(pool: pg.Pool): Promise<void> {
  const enterprise = await pool.query('select code, name, status from app.enterprises where id=$1::bigint', [ENTERPRISE_ID]);
  const enterpriseRow = enterprise.rows[0];
  if (!enterpriseRow || enterpriseRow.code !== `B4-LIVE-${ENTERPRISE_ID}`
    || !String(enterpriseRow.name).startsWith('[B4]') || enterpriseRow.status !== 'active') {
    fail('fixture enterprise ownership mismatch; run the B4 fixture first');
  }
  const user = await pool.query('select username, context_version from app.users where id=$1::bigint', [CUSTOMER_USER_ID]);
  if (!user.rows[0] || !String(user.rows[0].username).startsWith('b4-live-customer-')) {
    fail('fixture customer ownership mismatch');
  }
  const identity = await pool.query('select openid from app.wechat_identities where user_id=$1::bigint', [CUSTOMER_USER_ID]);
  if (identity.rows[0]?.openid !== CUSTOMER_OPENID) fail('fixture WeChat identity mismatch; run the B4 fixture');
  const project = await pool.query(
    'select name, status, current_stage_key, customer_access, progress_revision, progress_note from app.construction_projects where id=$1::bigint',
    [PROJECT_ID],
  );
  const projectRow = project.rows[0];
  if (!projectRow || !String(projectRow.name).startsWith('[B4]') || projectRow.status !== 'active'
    || projectRow.current_stage_key !== STAGE_KEY || projectRow.customer_access !== true) {
    fail('fixture project is not the active labelled stage-reminder project');
  }
  const conversation = await pool.query(
    "select title, purpose, status, mode from app.assistant_conversations where id=$1::bigint",
    [CONVERSATION_ID],
  );
  const conversationRow = conversation.rows[0];
  if (!conversationRow || !String(conversationRow.title).startsWith('[B4]')
    || conversationRow.purpose !== 'customer_consultation' || conversationRow.status !== 'open' || conversationRow.mode !== 'ai') {
    fail('fixture conversation is not the labelled open customer consultation');
  }
  const settings = await pool.query(
    'select enabled, stage_enabled from app.construction_report_settings where enterprise_id=$1::bigint',
    [ENTERPRISE_ID],
  );
  if (!settings.rows[0] || settings.rows[0].enabled !== false || settings.rows[0].stage_enabled !== false) {
    fail('the legacy report plan for the test tenant must be explicitly disabled');
  }
}

/** Advance the synthetic project revision so the workflow creates one new event. */
async function bumpSyntheticProgress(pool: pg.Pool, note: string): Promise<Row> {
  const result = await pool.query(
    `update app.construction_projects
       set progress_revision=progress_revision+1, progress_note=$2, version=version+1, updated_at=now()
     where id=$1::bigint and enterprise_id=$3::bigint and current_stage_key=$4 and status='active'
     returning progress_revision, progress_note, version`,
    [PROJECT_ID, note, ENTERPRISE_ID, STAGE_KEY],
  );
  if (!result.rows[0]) fail('synthetic progress update did not match the labelled project');
  return result.rows[0] as Row;
}

function runCli(args: string[]): Row {
  const output = execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'scripts/native-workflow-live.ts',
      '--development',
      '--ensure-published',
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        B4_LIVE_APP_DATABASE_URL: appTarget.url,
        B4_LIVE_FIXTURE_DATABASE_URL: fixtureTarget.url,
        NATIVE_WORKFLOW_STORE_DIR: acceptanceStoreDir,
        NATIVE_WORKFLOW_RUN_DIR: acceptanceRunDir,
      },
      timeout: 180_000,
    },
  );
  const start = output.indexOf('{');
  if (start < 0) fail(`CLI produced no JSON: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(start)) as Row;
}

async function main(): Promise<void> {
  process.env.DATABASE_URL = appTarget.url;
  // The assistant entry token needs a local signing secret. This is a B-local
  // development value, never a production credential.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'b4-dev-jwt-user-loop';
  const pool = ownerPool();
  let crossConversationCreated = false;
  let participantRevoked = false;
  let customerAccessRevoked = false;
  let sourceEventId: string | null = null;

  /** Remove only this run's marker-matching temporary rows. */
  async function cleanupAcceptanceRows(): Promise<{ result: Row; error: string | null }> {
    if (!crossConversationCreated) return { result: { ran: false }, error: null };
    try {
      const client = await pool.connect();
      try {
        const result = await cleanupAcceptanceConversation(client, {
          enterpriseId: ENTERPRISE_ID,
          conversationId: crossConversationId,
          participantId: crossParticipantId,
        });
        crossConversationCreated = false;
        return { result: { ran: true, ...result }, error: null };
      } finally {
        client.release();
      }
    } catch (error) {
      return { result: { ran: false }, error: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    await step('preflight', async () => {
      const identity = await withTenantTransaction(ENTERPRISE_ID, (tx) => one(
        tx,
        sql`select current_database() as database, current_user as username`,
      ));
      assertB4ConnectionIdentity(appTarget, {
        database: String(identity?.database ?? ''),
        username: String(identity?.username ?? ''),
      });
      const fixtureIdentity = await pool.query<{ database: string; username: string }>(
        'select current_database() as database, current_user as username',
      );
      assertB4ConnectionIdentity(fixtureTarget, fixtureIdentity.rows[0]!);
      await preflight(pool);
      const before = await usageSnapshot(pool);
      evidence.countsBefore = before;
      const reportPlan = await pool.query(
        'select enabled, stage_enabled, stage_cursor from app.construction_report_settings where enterprise_id=$1::bigint',
        [ENTERPRISE_ID],
      );
      const queued = await pool.query(
        "select count(*)::int as count from app.assistant_jobs where status in ('queued','running')",
      );
      assert.equal(queued.rows[0]?.count, 0, 'acceptance must not start with a queued/running assistant job');
      check('preflight', true, { reportPlan: reportPlan.rows[0], queuedJobs: 0 });
    });

    // Publish only inside the dedicated per-run store. A fresh store starts
    // empty, so this creates the template and publishes revision 1; the normal
    // B management store is never opened by this acceptance.
    let published: Row;
    await step('publish fixed revision', async () => {
      const publication = await publishAcceptanceDefinition({
        storeDir: acceptanceStoreDir,
        definitionId: 'stage-reminder',
      });
      published = {
        definitionId: publication.definitionId,
        revision: publication.revision,
        digest: publication.digest,
        created: publication.created,
        storeDir: acceptanceStoreDir,
        template: publication.version.definition.nodes.find((node) => node.nodeId === 'compose-deterministic')?.config,
      };
      evidence.published = published;
      check('publish fixed revision', true, published);
    });

    const revision = String(published!.revision);
    evidence.fixedRevision = revision;

    await step('execute the real synthetic stage event', async () => {
      const progress = await bumpSyntheticProgress(pool, '水路打压完成，等待业主确认。');
      evidence.syntheticProgress = progress;
      const output = runCli([
        '--revision', revision,
        '--admin-id', ADMIN_ID,
        '--project-id', PROJECT_ID,
        '--event-id', eventId,
        '--stage-key', STAGE_KEY,
        '--stage-label', STAGE_LABEL,
        '--run-id', runId,
      ]);
      evidence.cli = output;
      assert.equal(output.success, true, `CLI run did not complete: ${JSON.stringify(output.error)}`);
      assert.equal(output.status, 'completed');
      const binding = output.binding as Row;
      assert.equal(binding.revision, Number(revision));
      assert.equal(binding.digest, published!.digest);
      const saveReceipt = output.saveReceipt as Row;
      const deliveryReceipt = output.deliveryReceipt as Row;
      assert.equal(saveReceipt.simulated, false);
      assert.equal(deliveryReceipt.simulated, false);
      assert.equal(deliveryReceipt.status, 'delivered');
      assert.ok(saveReceipt.eventId);
      assert.ok(deliveryReceipt.messageId);
      evidence.eventIdDb = String(saveReceipt.eventId);
      evidence.messageId = String(deliveryReceipt.messageId);
      evidence.deliveryId = String(deliveryReceipt.receiptId);
      evidence.conversationId = String(deliveryReceipt.conversationId);
      check('execute the real synthetic stage event', true, {
        saveReceipt: { eventId: saveReceipt.eventId, simulated: saveReceipt.simulated },
        deliveryReceipt: {
          receiptId: deliveryReceipt.receiptId,
          messageId: deliveryReceipt.messageId,
          conversationId: deliveryReceipt.conversationId,
        },
      });
    });

    const messageId = String(evidence.messageId);
    const outboxEventId = String(evidence.eventIdDb);
    const realConversationId = String(evidence.conversationId);

    await step('database correspondence', async () => {
      const event = await pool.query(
        `select id, type, aggregate_id, aggregate_version, payload->>'stageKey' as stage_key,
                payload->>'sourceEventKey' as source_event_key, payload->>'text' as text
           from app.domain_event_outbox where id=$1::bigint`,
        [outboxEventId],
      );
      const delivery = await pool.query(
        'select id, event_id, consumer_key, status from app.domain_event_deliveries where id=$1::bigint',
        [String(evidence.deliveryId)],
      );
      const message = await pool.query(
        `select id, conversation_id, seq, author_kind, purpose, source_event_id,
                content->'blocks'->0->>'text' as text
           from app.assistant_messages where id=$1::bigint`,
        [messageId],
      );
      assert.equal(event.rows[0]?.type, 'construction.stage.updated.v1');
      assert.equal(String(event.rows[0]?.aggregate_id), PROJECT_ID);
      assert.equal(event.rows[0]?.stage_key, STAGE_KEY);
      assert.ok(String(event.rows[0]?.text).includes('[B4] 水路阶段测试项目'));
      assert.ok(String(event.rows[0]?.text).includes('水路管线已铺设完成'));
      assert.ok(!String(event.rows[0]?.text).includes('验收通过'));
      assert.equal(delivery.rows[0]?.status, 'delivered');
      assert.equal(String(delivery.rows[0]?.event_id), outboxEventId);
      assert.equal(String(message.rows[0]?.conversation_id), realConversationId);
      assert.equal(String(message.rows[0]?.source_event_id), outboxEventId);
      assert.equal(message.rows[0]?.purpose, 'construction.stage');
      assert.equal(message.rows[0]?.author_kind, 'system');
      evidence.databaseRows = { event: event.rows[0], delivery: delivery.rows[0], message: message.rows[0] };
      check('database correspondence', true, {
        eventId: outboxEventId,
        deliveryId: evidence.deliveryId,
        messageId,
        conversationId: realConversationId,
      });
    });

    // The original XiaoK client path: mint the same customer session the Mini
    // Program uses, then read entry context, history and the message window.
    const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
    const { assistantHttp } = await import('@/lib/assistant/application/http');
    const contextVersion = Number((await pool.query(
      'select context_version from app.users where id=$1::bigint',
      [CUSTOMER_USER_ID],
    )).rows[0]?.context_version);
    const api = async (token: string, apiPath: string[], init: RequestInit = {}) => {
      const request = new Request(`http://127.0.0.1:3006/api/miniprogram/assistant/${apiPath.join('/')}`, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + token,
          ...(init.headers as Record<string, string> || {}),
        },
      });
      const response = await assistantHttp(request, apiPath);
      return { status: response.status, body: await response.json() as Row };
    };
    const session = async () => {
      const token = await signMiniProgramToken({
        sub: CUSTOMER_USER_ID,
        id: CUSTOMER_USER_ID,
        mode: 'customer',
        role: 'user',
        enterpriseId: ENTERPRISE_ID,
        contextVersion,
        source: 'wechat',
      });
      const entry = await api(token, ['entry-context'], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: LEAD_ID }),
      });
      assert.equal(entry.status, 200, `entry-context failed: ${JSON.stringify(entry.body)}`);
      const entryToken = (entry.body.data as Row).entryToken;
      const history = await api(token, ['conversations'], {
        headers: { 'X-Assistant-Entry': String(entryToken) },
      });
      assert.equal(history.status, 200);
      return { token, entryToken: String(entryToken), entry: entry.body.data as Row, history: history.body.data as Row };
    };
    const readMessagesWithQuery = async (token: string, conversationId: string, query = '') => {
      const request = new Request(
        `http://127.0.0.1:3006/api/miniprogram/assistant/conversations/${conversationId}/messages${query}`,
        { headers: { Authorization: 'Bearer ' + token } },
      );
      const response = await assistantHttp(request, ['conversations', conversationId, 'messages']);
      return { status: response.status, body: await response.json() as Row };
    };

    const first = await step('original XiaoK entry reads the same message', async () => {
      const current = await session();
      const detail = await api(current.token, ['conversations', realConversationId]);
      assert.equal(detail.status, 200);
      const conversation = detail.body.data as Row;
      const window = await readMessagesWithQuery(current.token, realConversationId, '?limit=100');
      assert.equal(window.status, 200);
      const items = (window.body.data as Row).items as Row[];
      const message = items.find((item) => String(item.id) === messageId);
      assert.ok(message, `message ${messageId} is missing from the original XiaoK window`);
      assert.equal(message.authorKind, 'system');
      assert.equal(message.available, true);
      assert.equal(message.constructionReminder, true);
      assert.deepEqual(message.citations, []);
      const text = ((message.content as Row).blocks as Row[]).map((block) => String(block.text ?? '')).join('\n');
      assert.ok(text.includes('[B4] 水路阶段测试项目'));
      assert.ok(text.includes('水路管线已铺设完成'));
      assert.ok(!text.includes('验收通过'));
      const historyItems = (current.history.items as Row[] | undefined) ?? [];
      assert.ok(historyItems.some((item) => String(item.id) === realConversationId), 'history does not expose the real conversation');
      evidence.originalEntry = {
        enterprise: current.entry.enterprise,
        history: historyItems.map((item) => ({ id: item.id, title: item.title, purpose: item.purpose })),
        conversation: { id: conversation.id, lastSeq: conversation.lastSeq },
        message: { id: message.id, seq: message.seq, constructionReminder: message.constructionReminder, text },
        items: items.length,
      };
      check('original XiaoK entry reads the same message', true, {
        messageId, conversationId: realConversationId, itemCount: items.length, historyCount: historyItems.length,
      });
      return { current, latestSeq: String((window.body.data as Row).latestSeq), items };
    });

    await step('exit and re-enter restores from the server without a duplicate', async () => {
      // A fresh session + fresh entry token is the API equivalent of closing
      // the page/small program and entering the original XiaoK chat again.
      const again = await session();
      const full = await readMessagesWithQuery(again.token, realConversationId, '?limit=100');
      assert.equal(full.status, 200);
      const items = (full.body.data as Row).items as Row[];
      assert.equal(items.length, first.items.length);
      assert.equal(items.filter((item) => String(item.id) === messageId).length, 1);
      const delta = await readMessagesWithQuery(again.token, realConversationId, `?afterSeq=${first.latestSeq}&limit=100`);
      assert.equal(delta.status, 200);
      assert.deepEqual((delta.body.data as Row).items, []);
      const deltaAgain = await readMessagesWithQuery(again.token, realConversationId, `?afterSeq=${first.latestSeq}&limit=100`);
      assert.deepEqual((deltaAgain.body.data as Row).items, []);
      const after = await usageSnapshot(pool);
      assert.deepEqual(after, evidence.countsBefore);
      evidence.countsAfterReentry = after;
      check('exit and re-enter restores from the server without a duplicate', true, {
        items: items.length, deltaItems: 0,
      });
    });

    await step('replaying the same business event does not add a message', async () => {
      const beforeCount = await counter(pool, 'app.assistant_messages', `conversation_id=${CONVERSATION_ID} and purpose='construction.stage'`);
      // A new runId for the same source event must reuse the original outbox,
      // delivery and message. (Same-runId replay is covered by the B4 runner
      // unit tests; this entry always resolves a fresh run identity.)
      const secondRunId = `${runId}-repeat`;
      const repeated = runCli([
        '--revision', revision,
        '--admin-id', ADMIN_ID,
        '--project-id', PROJECT_ID,
        '--event-id', eventId,
        '--stage-key', STAGE_KEY,
        '--stage-label', STAGE_LABEL,
        '--run-id', secondRunId,
      ]);
      assert.equal(repeated.status, 'completed');
      const saveReceipt = repeated.saveReceipt as Row;
      const deliveryReceipt = repeated.deliveryReceipt as Row;
      assert.equal(saveReceipt.reused, true);
      assert.equal(String(saveReceipt.eventId), outboxEventId);
      assert.equal(deliveryReceipt.status, 'delivered');
      assert.equal(String(deliveryReceipt.messageId), messageId);
      const afterCount = await counter(pool, 'app.assistant_messages', `conversation_id=${CONVERSATION_ID} and purpose='construction.stage'`);
      assert.equal(afterCount, beforeCount);
      evidence.duplicate = {
        repeated: {
          saveReceipt: repeated.saveReceipt,
          deliveryReceipt: repeated.deliveryReceipt,
        },
        stageMessages: { before: beforeCount, after: afterCount },
      };
      check('replaying the same business event does not add a message', true, {
        stageMessages: afterCount,
        sameMessageId: String(deliveryReceipt.messageId) === messageId,
      });
    });

    await step('cross-conversation keeps the real conversation', async () => {
      // One transaction: an occupied id refuses before any write, and a failed
      // participant insert leaves no conversation behind.
      const client = await pool.connect();
      try {
        const created = await createAcceptanceConversation(client, {
          enterpriseId: ENTERPRISE_ID,
          conversationId: crossConversationId,
          participantId: crossParticipantId,
          customerUserId: CUSTOMER_USER_ID,
          leadId: LEAD_ID,
        });
        crossConversationCreated = true;
        evidence.acceptanceIds = { ...(evidence.acceptanceIds as Row), ...created };
      } finally {
        client.release();
      }
      const beforeCount = await counter(pool, 'app.assistant_messages', `conversation_id=${CONVERSATION_ID} and purpose='construction.stage'`);
      const crossRunId = `${runId}-cross`;
      const cross = runCli([
        '--revision', revision,
        '--admin-id', ADMIN_ID,
        '--project-id', PROJECT_ID,
        '--event-id', eventId,
        '--stage-key', STAGE_KEY,
        '--stage-label', STAGE_LABEL,
        '--run-id', crossRunId,
      ]);
      assert.equal(cross.status, 'completed');
      const receipt = cross.deliveryReceipt as Row;
      assert.equal(String(receipt.conversationId), realConversationId);
      assert.equal(String(receipt.requestedConversationId), crossConversationId);
      assert.equal(receipt.reusedConversation, true);
      assert.equal(String(receipt.messageId), messageId);
      const crossSession = await session();
      const crossMessages = await readMessagesWithQuery(crossSession.token, crossConversationId, '?limit=100');
      assert.equal(crossMessages.status, 200);
      assert.equal(((crossMessages.body.data as Row).items as Row[]).some((item) => item.constructionReminder), false);
      const realMessages = await readMessagesWithQuery(crossSession.token, realConversationId, '?limit=100');
      assert.equal(((realMessages.body.data as Row).items as Row[]).some((item) => String(item.id) === messageId), true);
      const afterCount = await counter(pool, 'app.assistant_messages', `conversation_id=${CONVERSATION_ID} and purpose='construction.stage'`);
      assert.equal(afterCount, beforeCount);
      evidence.crossConversation = {
        receipt: {
          conversationId: receipt.conversationId,
          requestedConversationId: receipt.requestedConversationId,
          reusedConversation: receipt.reusedConversation,
          messageId: receipt.messageId,
        },
        stageMessages: { before: beforeCount, after: afterCount },
      };
      check('cross-conversation keeps the real conversation', true, evidence.crossConversation as Row);
    });

    await step('participant revocation removes the history entry and read', async () => {
      await pool.query(
        `update app.assistant_participants set status='revoked', revoked_at=now(), version=version+1, updated_at=now()
          where enterprise_id=$1::bigint and conversation_id=$2::bigint and user_id=$3::bigint`,
        [ENTERPRISE_ID, CONVERSATION_ID, CUSTOMER_USER_ID],
      );
      participantRevoked = true;
      try {
        const current = await session();
        const detail = await api(current.token, ['conversations', realConversationId]);
        assert.equal(detail.status, 404);
        const historyItems = (current.history.items as Row[] | undefined) ?? [];
        assert.equal(historyItems.some((item) => String(item.id) === realConversationId), false);
        check('participant revocation removes the history entry and read', true, {
          detailStatus: detail.status, historyCount: historyItems.length,
        });
      } finally {
        await pool.query(
          `update app.assistant_participants set status='active', revoked_at=null, version=version+1, updated_at=now()
            where enterprise_id=$1::bigint and conversation_id=$2::bigint and user_id=$3::bigint`,
          [ENTERPRISE_ID, CONVERSATION_ID, CUSTOMER_USER_ID],
        );
        participantRevoked = false;
      }
    });

    await step('customer-access revocation hides the reminder instead of claiming success', async () => {
      await pool.query(
        'update app.construction_projects set customer_access=false, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
        [ENTERPRISE_ID, PROJECT_ID],
      );
      customerAccessRevoked = true;
      try {
        const current = await session();
        const window = await readMessagesWithQuery(current.token, realConversationId, '?limit=100');
        assert.equal(window.status, 200);
        const message = ((window.body.data as Row).items as Row[]).find((item) => String(item.id) === messageId);
        assert.ok(message);
        assert.equal(message.available, false);
        assert.equal(message.constructionReminder, false);
        const blocks = (message.content as Row).blocks as Row[];
        assert.equal(blocks[0]?.type, 'notice');
        check('customer-access revocation hides the reminder instead of claiming success', true, {
          available: message.available,
          constructionReminder: message.constructionReminder,
          blockType: blocks[0]?.type,
        });
      } finally {
        await pool.query(
          'update app.construction_projects set customer_access=true, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
          [ENTERPRISE_ID, PROJECT_ID],
        );
        customerAccessRevoked = false;
      }
    });

    await step('source invalidation hides the old stage notice', async () => {
      const inserted = await pool.query(
        `insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
         values($1::bigint,'construction.stage.updated.v1','construction_project',$2::text,
           (select progress_revision+1 from app.construction_projects where id=$3::bigint),
           '{"kind":"system"}',$4,$5::jsonb) returning id`,
        [ENTERPRISE_ID, PROJECT_ID, PROJECT_ID, `${runId}-source-invalidation`,
          JSON.stringify({ projectId: PROJECT_ID, stageKey: STAGE_KEY, settingsVersion: 1, text: '合成来源失效检查' })],
      );
      sourceEventId = String(inserted.rows[0]?.id);
      try {
        const current = await session();
        const window = await readMessagesWithQuery(current.token, realConversationId, '?limit=100');
        assert.equal(window.status, 200);
        const message = ((window.body.data as Row).items as Row[]).find((item) => String(item.id) === messageId);
        assert.ok(message);
        assert.equal(message.available, false);
        assert.equal(message.constructionReminder, false);
        check('source invalidation hides the old stage notice', true, { available: message.available });
      } finally {
        await pool.query('delete from app.domain_event_outbox where id=$1::bigint', [sourceEventId]);
        sourceEventId = null;
      }
    });

    await step('zero model, FastGPT and embedding calls in the acceptance window', async () => {
      const after = await usageSnapshot(pool);
      assert.deepEqual(after, evidence.countsBefore);
      const reportPlan = await pool.query(
        'select enabled, stage_enabled from app.construction_report_settings where enterprise_id=$1::bigint',
        [ENTERPRISE_ID],
      );
      assert.equal(reportPlan.rows[0]?.enabled, false);
      assert.equal(reportPlan.rows[0]?.stage_enabled, false);
      const queued = await pool.query(
        "select count(*)::int as count from app.assistant_jobs where status in ('queued','running')",
      );
      assert.equal(queued.rows[0]?.count, 0);
      evidence.countsAfter = after;
      check('zero model, FastGPT and embedding calls in the acceptance window', true, {
        before: evidence.countsBefore, after,
      });
    });

    // Cleanup runs before success is decided: a run that leaves temporary rows
    // behind is not a success, even when every check passed.
    const cleanup = await cleanupAcceptanceRows();
    evidence.cleanup = cleanup.result;
    if (cleanup.error) evidence.cleanupError = cleanup.error;
    if (cleanup.error) {
      (evidence.failures as Row[]).push({ name: 'cleanup acceptance rows', error: cleanup.error });
    } else if (cleanupIncomplete(cleanup.result)) {
      (evidence.failures as Row[]).push({
        name: 'cleanup acceptance rows',
        reason: cleanup.result.reason ?? 'cleanup did not confirm ownership of every temporary row',
        result: cleanup.result,
      });
    }

    // The normal B management store must be byte-identical before and after.
    const normalStoreAfter = snapshotFile(normalStoreFile);
    evidence.normalStore = { ...(evidence.normalStore as Row), after: normalStoreAfter };
    const normalStoreUnchanged = JSON.stringify(normalStoreBefore) === JSON.stringify(normalStoreAfter);
    evidence.normalStoreUnchanged = normalStoreUnchanged;
    if (!normalStoreUnchanged) {
      (evidence.failures as Row[]).push({
        name: 'normal store untouched', before: normalStoreBefore, after: normalStoreAfter,
      });
    }

    evidence.finishedAt = new Date().toISOString();
    evidence.success = (evidence.failures as Row[]).length === 0 && !cleanup.error;
    save();
    console.log(JSON.stringify({
      success: evidence.success,
      runId,
      eventId,
      definitionRevision: revision,
      digest: published!.digest,
      messageId,
      outboxEventId,
      conversationId: realConversationId,
      acceptancePaths: evidence.acceptancePaths,
      acceptanceIds: evidence.acceptanceIds,
      normalStore: evidence.normalStore,
      cleanup: evidence.cleanup,
      cleanupError: evidence.cleanupError ?? null,
      verificationFile,
      checks: (evidence.checks as Row[]).map((entry) => ({ name: entry.name, passed: entry.passed })),
      countsBefore: evidence.countsBefore,
      countsAfter: evidence.countsAfter,
    }, null, 2));
    if (!evidence.success) process.exitCode = 2;
  } finally {
    if (participantRevoked) {
      await pool.query(
        `update app.assistant_participants set status='active', revoked_at=null, version=version+1, updated_at=now()
          where enterprise_id=$1::bigint and conversation_id=$2::bigint and user_id=$3::bigint`,
        [ENTERPRISE_ID, CONVERSATION_ID, CUSTOMER_USER_ID],
      ).catch(() => undefined);
    }
    if (customerAccessRevoked) {
      await pool.query(
        'update app.construction_projects set customer_access=true, version=version+1, updated_at=now() where enterprise_id=$1::bigint and id=$2::bigint',
        [ENTERPRISE_ID, PROJECT_ID],
      ).catch(() => undefined);
    }
    if (sourceEventId) {
      await pool.query('delete from app.domain_event_outbox where id=$1::bigint', [sourceEventId]).catch(() => undefined);
    }
    // Crash-safety net for a failure before the explicit cleanup above. The
    // helper still deletes only rows that carry this run's marker.
    if (crossConversationCreated) {
      const safety = await cleanupAcceptanceRows();
      evidence.cleanup = safety.result;
      if (safety.error) {
        evidence.cleanupError = safety.error;
        (evidence.failures as Row[]).push({ name: 'cleanup acceptance rows', error: safety.error });
      } else if (cleanupIncomplete(safety.result)) {
        (evidence.failures as Row[]).push({
          name: 'cleanup acceptance rows',
          reason: safety.result.reason ?? 'cleanup did not confirm ownership of every temporary row',
          result: safety.result,
        });
      }
      // Only a run that never reached its own finalization needs this net, so
      // it can never report overall success even when the retry cleaned up.
      evidence.success = false;
      if (!process.exitCode) process.exitCode = 2;
      save();
    }
    await pool.end().catch(() => undefined);
    await closePostgresPool().catch(() => undefined);
  }
}

main().catch((error) => {
  evidence.success = false;
  evidence.finishedAt = new Date().toISOString();
  (evidence.failures as Row[]).push({ error: error instanceof Error ? error.stack || error.message : String(error) });
  save();
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    verificationFile,
  }));
  process.exitCode = 1;
});
