/* eslint-disable @typescript-eslint/no-explicit-any -- Deterministic postchecks for the retained real-model matrix evidence. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);

const label = process.argv.find(x => x.startsWith('--label='))?.slice(8) || 'rm-01';
assert.match(label, /^[a-z0-9-]+$/);
const evidence = path.resolve('../tmp/xiaok-fastgpt-agentv2-model-switch-20261109');
const batch = path.join(evidence, 'real-matrix-' + label);
const source = path.join(batch, 'assessment.json');
const out = path.join(batch, 'postchecks.json');
assert.ok(fs.existsSync(source), 'The retained matrix assessment must exist');
assert.ok(!fs.existsSync(out), 'Preserve every original postcheck batch');

const originalDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/connection.private.json'), 'utf8')).DATABASE_URL;

const { sql } = require('drizzle-orm');
const { withTenantTransaction, withPlatformTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { ConversationService } = require(path.resolve('src/lib/assistant/core/conversation.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');

const tenant = (f: any) => withTenantTransaction('1454', f);
const platform = (f: any) => withPlatformTransaction(f);
const matrix = JSON.parse(fs.readFileSync(source, 'utf8'));
assert.equal(matrix.label, label);
const craft = matrix.runs.find((run: any) => run.name === 'f3-q1-t1' && run.citations?.length);
assert.ok(craft?.conversationId && craft.messageId && craft.citations[0]?.id, 'A retained cited craft answer is required');
const citationId = String(craft.citations[0].id);
const report: any = { label, sourceRun: craft.runId, sourceMessage: craft.messageId, sourceCitation: citationId,
  sourceTitle: craft.citations[0].title, checks: {}, denials: {}, cleanup: {} };
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));

let release: any, restrictedDoc: string | undefined, audienceRestricted = false;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: true });
  const customer = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id='645'`));
  assert.ok(customer, 'Eval user 645 must exist');
  const actor: any = { enterpriseId: '1454', principal: { kind: 'user', userId: '645' },
    contextVersion: Number(customer.context_version), capabilities: ['assistant.chat.self'] };
  report.customer = { id: String(customer.id), contextVersion: actor.contextVersion };
  const service = new ConversationService(actor);
  const readAnswer = async () => (await service.messages(craft.conversationId)).items.find((m: any) => m.id === craft.messageId);
  const readCitation = () => service.citation(citationId, false, craft.conversationId);

  const baseline = await readAnswer();
  assert.equal(baseline?.available, true, 'The retained answer must start readable');
  assert.equal((await readCitation()).available, true, 'The retained citation must start readable');
  report.checks.baselineReadable = true;
  const storedInternalField = /1724|254|（1818）|\d{4}-\d{2}-\d{2}T|\[|(?:发布记录|记录|版本)\s*\d+|resultKey|leadId/;
  const storedCraftAnswers = matrix.runs.filter((run: any) => run.name.startsWith('f3-') && run.answer);
  for (const run of storedCraftAnswers)
    assert.equal(storedInternalField.test(String(run.answer)), false, `Stored craft answer exposes internal fields: ${run.name}`);
  report.checks.storedAnswerInternalFieldsHidden = storedCraftAnswers.length;
  save();

  const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
  assert.equal(knowledgeFixture.enterpriseId, '1454');
  const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: String(knowledgeFixture.adminIds[0]) });
  const citationRow = await tenant((tx: any) => one(tx, sql`select document_id::text document_id from app.assistant_message_citations
    where enterprise_id=1454 and id=${citationId}`));
  assert.ok(citationRow?.document_id, 'The retained citation must reference a knowledge document');
  restrictedDoc = String(citationRow.document_id);
  report.document = restrictedDoc;
  const detail = await knowledge.execute('detail', { documentId: restrictedDoc });
  if (detail.document.audience !== 'staff_internal') {
    await knowledge.execute('metadata', { documentId: restrictedDoc, expectedVersion: Number(detail.document.version), audience: 'staff_internal' }, randomUUID());
    audienceRestricted = true;
  }
  assert.equal((await readAnswer()).available, false, 'A revoked source must hide the answer');
  assert.equal((await readCitation()).available, false, 'A revoked source must hide the citation');
  report.checks.revokedHidden = true; save();

  const restored = await knowledge.execute('detail', { documentId: restrictedDoc });
  if (restored.document.audience !== 'customer_public')
    await knowledge.execute('metadata', { documentId: restrictedDoc, expectedVersion: Number(restored.document.version), audience: 'customer_public' }, randomUUID());
  audienceRestricted = false; restrictedDoc = undefined;
  assert.equal((await readAnswer()).available, true, 'Restoring the source must restore the answer');
  assert.equal((await readCitation()).available, true, 'Restoring the source must restore the citation');
  report.checks.restoredReadable = true; save();

  const outsiderUser = await platform((tx: any) => one(tx, sql`select id,context_version from app.users where id='744'`));
  assert.ok(outsiderUser, 'Other-customer fixture 744 must exist');
  const outsider: any = { enterpriseId: '1454', principal: { kind: 'user', userId: '744' },
    contextVersion: Number(outsiderUser.context_version), capabilities: ['assistant.chat.self'] };
  await assert.rejects(new ConversationService(outsider).messages(craft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
  await assert.rejects(new ConversationService(outsider).suggestions(craft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
  await assert.rejects(new ConversationService(outsider).citation(citationId, false, craft.conversationId), (e: any) => e?.code === 'assistant_resource_not_found');
  report.denials.otherCustomer = 'assistant_resource_not_found';
  await assert.rejects(new ConversationService({ ...actor, enterpriseId: '2385' }).citation(citationId, false, craft.conversationId));
  report.denials.crossTenant = 'rejected'; save();

  report.status = 'passed'; save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); save();
  console.error(report.error); process.exitCode = 1;
} finally {
  const cleanup = async (key: string, f: () => Promise<any>) => { try { await f(); report.cleanup[key] = true; } catch (e) { report.cleanup[key] = String(e); process.exitCode = 1; } };
  if (audienceRestricted && restrictedDoc) await cleanup('audienceRestored', async () => {
    const knowledgeFixture = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json'), 'utf8'));
    const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: String(knowledgeFixture.adminIds[0]) });
    const detail = await knowledge.execute('detail', { documentId: restrictedDoc! });
    if (detail.document.audience !== 'customer_public')
      await knowledge.execute('metadata', { documentId: restrictedDoc!, expectedVersion: Number(detail.document.version), audience: 'customer_public' }, randomUUID());
  });
  if (release) await cleanup('lockReleased', release);
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); save();
}
