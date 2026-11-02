/* eslint-disable @typescript-eslint/no-require-imports -- CJS adapter loaded by the existing tsx acceptance driver. */
/* Run via xiaok-v1-02-report-context-check.ts --development --adapter-script=...
 * Persisted protocol body + real published Evidence. No generation/ingestion. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { createHash, randomUUID } = require('node:crypto');
module.exports = async ctx => {
  const { root, output, actor, pid, bid, cid, rid, read, step, owner } = ctx;
  const req = createRequire(path.join(root, 'admin/package.json')), { sql } = req('drizzle-orm');
  const { one, AssistantRepository } = req('./src/db/repositories/assistant-repository.ts');
  const { FollowupService } = req('./src/lib/construction/followup-service.ts');
  const { resolveReportReference, reportContextProtocol } = req('./src/lib/construction/report-reference.ts');
  const { reportKnowledgeSource } = req('./src/lib/construction/report-body-view.ts');
  const { parseReportBody, reportSectionKinds } = req('./src/lib/construction/report-composition.ts');
  const { sourceReady, sourceScope } = req('./src/lib/assistant/knowledge/sources.ts');
  const { knowledgeSynthesisSources, businessSynthesisSources } = req('./src/lib/assistant/agent/synthesis.ts');
  const { sourceCitationCatalog } = req('./src/lib/assistant/agent/citation-catalog.ts');
  const { knowledgeContext } = req('./src/lib/assistant/knowledge/applicability-context.ts');
  const { applicability } = req('./src/lib/assistant/knowledge/professional.ts');
  const { reportFactText } = req('./src/lib/assistant/agent/report-context.ts');
  const { withPlatformTransaction } = req('./src/db/transaction.ts'), { SignJWT } = req('jose');
  ctx.report.scope = 'V1-02 approved03 saved report source/original navigation; real Evidence and HTTP, synthetic persisted body, zero model/embedding/ingestion'; ctx.save();
  const service = new FollowupService(actor), nativePath = process.argv.find(a => a.startsWith('--report-source-native='))?.slice(23);
  const nativeHash = nativePath ? createHash('sha256').update(fs.readFileSync(path.resolve(nativePath))).digest('hex') : null;
  const remainderPath = process.argv.find(a => a.startsWith('--report-source-remainder='))?.slice(26);
  if (remainderPath) {
    const previous = JSON.parse(fs.readFileSync(path.resolve(remainderPath), 'utf8'));
    assert.equal(previous.cleanup, true); assert.deepEqual(previous.drift, []); assert.ok(previous.checks.slice(0, 4).every(c => c.passed));
    assert.equal(previous.checks[4].passed, false);
    const binding = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(remainderPath)), 'binding.json'), 'utf8')).before;
    const changed = Object.keys(binding).filter(f => createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f))).digest('hex') !== binding[f]);
    assert.deepEqual(changed.sort(), ['admin/scripts/xiaok-v1-02-report-source-check.cjs','admin/src/lib/assistant/knowledge/file-service.ts',
      'miniprogram/packages/assistant/lib/followups.js','miniprogram/test/assistant-report-sources.test.js']);
    ctx.report.sourceEvidenceReuse = { source: path.relative(root, path.resolve(remainderPath)), checks: previous.checks.slice(2, 4), changed,
      failedBatchRetained: true, effect: 'file disclosure predicate moved to a unit-tested function; compatible polling no longer cancels an in-flight download; recipient/catalog/source predicates unchanged; fresh file HTTP and native remainder only' };
    ctx.save();
  }
  let body, source, sourceId, originalHash, token;
  const entries = new Map();
  const jwt = async uid => {
    const u = await withPlatformTransaction(tx => one(tx, sql`select context_version from app.users where id=${uid}`));
    const credential = await new SignJWT({ id: uid, mode: 'customer', role: 'user', enterpriseId: '1454', contextVersion: Number(u.context_version), source: 'password' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const response = await fetch('http://127.0.0.1:3006/api/miniprogram/assistant/entry-context', { method: 'POST',
      headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: uid === '3914' ? '3143' : '3144' }) });
    const entry = await response.json(); assert.equal(response.status, 200); assert.ok(entry.data.entryToken);
    entries.set(credential, entry.data.entryToken); return credential;
  };
  const sourceUrl = (suffix = '', sid = sourceId, projectId = pid, revision = 1) => `/api/miniprogram/assistant/followups/${bid}/reports/${rid}/projects/${projectId}/sources/${sid}${suffix}?revision=${revision}`;
  const get = async (url, expected = 200, credential = token, binary = false) => {
    const response = await fetch('http://127.0.0.1:3006' + url, { headers: { Authorization: 'Bearer ' + credential, 'X-Assistant-Entry': entries.get(credential) }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, expected, url + ' actual status ' + response.status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return binary && expected === 200 ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  const access = async value => {
    const p = (await owner.execute('detail', { projectId: pid })).project;
    await owner.execute('update', { projectId: pid, expectedVersion: p.version, name: p.name, status: 'active', customerAccess: value }, randomUUID());
  };
  await step('persist exact-catalog protocol body over real saved report facts and published Jingyi Evidence', async () => {
    const result = await read(async tx => {
      const c = await new AssistantRepository(tx, actor).conversation(cid), resolved = await resolveReportReference(tx, actor, { bindingId: bid, reportId: rid, revision: 1, projectId: pid });
      assert.ok(resolved);
      const selected = { ...c, entry_snapshot: { ...c.entry_snapshot, reportContext: { protocol: reportContextProtocol, revision: 0, selection: resolved.selection } } };
      source = await one(tx, sql`select c.*,d.id as document_id,d.title,v.professional,v.source_file from app.assistant_knowledge_chunks c
        join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
        join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
        join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
        join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
        where c.enterprise_id=1454 and d.id=404 and v.id=410 and ${sourceReady} and ${sourceScope(actor, selected)} order by c.ordinal limit 1`);
      assert.ok(source?.locator?.file, 'Use published page29 original, never draft or reingestion');
      const e = { ref: { type: 'knowledge_chunk', id: String(source.id), version: String(source.document_version_id) },
        text: source.text, hash: source.text_hash, file: source.locator.file };
      if (source.professional) {
        const context = await knowledgeContext(tx, actor, selected);
        e.professional = { documentId: String(source.document_id), title: source.title, contentHash: source.content_hash,
          entry: source.professional, context, applicability: applicability(source.professional, context) };
      }
      const snapshot = { query: { domain: 'construction', leadId: resolved.leadId }, customerId: actor.principal.userId, leadIds: [resolved.leadId],
        version: resolved.selection.factsHash, queriedAt: resolved.selection.cutoffAt, reportReference: { selection: resolved.selection, principal: actor.principal },
        data: [{ ...resolved.project, projectId: pid, leadId: resolved.leadId }], displayText: reportFactText(resolved.selection, resolved.project) };
      const context = { version: 1, knowledge: [e], snapshots: [snapshot], sources: [...businessSynthesisSources('source-protocol:' + rid, snapshot),
        ...knowledgeSynthesisSources([e], { [e.ref.id]: source.title })] };
      const knowledge = context.sources.find(s => s.kind === 'knowledge'), citation = sourceCitationCatalog(knowledge)[0];
      sourceId = knowledge.sourceId; originalHash = e.file.sourceHash;
      const sections = Object.fromEntries(reportSectionKinds.map(kind => [kind, { kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '本项请结合原记录核对，协议夹具不代表模型报告。', citations: [] }] }]));
      sections.standards = { kind: 'synthesis', segments: [{ basis: 'evidence', text: citation.quote, citations: [{ citationId: citation.citationId }] }] };
      body = parseReportBody(JSON.stringify({ projects: [{ projectId: pid, ...sections }] }), [{ projectId: pid, selection: resolved.selection, context }]);
      const before = await one(tx, sql`select facts_hash from app.construction_report_versions where enterprise_id=1454 and report_id=${rid} and revision=1`);
      // Only this newly created, labelled fixture. No generated model result or
      // attempt is fabricated; actual source resolution is the tested feature.
      await tx.execute(sql`update app.construction_report_versions set body=${JSON.stringify(body)}::jsonb,body_generated_at=now(),knowledge_status='ready',body_error_code=null
        where enterprise_id=1454 and report_id=${rid} and revision=1 and body is null`);
      assert.equal((await one(tx, sql`select facts_hash from app.construction_report_versions where enterprise_id=1454 and report_id=${rid} and revision=1`)).facts_hash, before.facts_hash);
      return { sourceId, documentId: String(source.document_id), versionId: String(source.document_version_id), originalHash, factsUnchanged: true, body: 'protocol fixture, not model output' };
    });
    const detail = await service.detail(bid, rid, 1);
    assert.equal(detail.contentStatus, 'composed'); assert.equal(detail.generationState, 'ready');
    assert.deepEqual(detail.body[0].knowledgeSources, [{ sourceId, title: source.title }]);
    assert.ok(!JSON.stringify(detail.body).includes('contextVersion') && !JSON.stringify(detail.body).includes('"evidence":'));
    token = await jwt('3914');
    return result;
  });
  if (!remainderPath) {
  await step('real authenticated source HTTP, original file bytes and persisted reentry', async () => {
    const excerpt = (await get(sourceUrl())).data;
    assert.equal(excerpt.available, true); assert.equal(excerpt.originalAvailable, true); assert.equal(excerpt.sourceFile.assetId, source.locator.file.assetId);
    assert.equal(excerpt.version, '410'); assert.ok(excerpt.quote); assert.equal(excerpt.title, source.title);
    const bytes = await get(sourceUrl('/original'), 200, token, true);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), originalHash);
    assert.deepEqual((await get(sourceUrl())).data, excerpt);
    assert.equal((await service.detail(bid, rid, 1)).reportId, rid);
    fs.writeFileSync(path.join(output, 'source-projection.json'), JSON.stringify({ excerpt, bytes: bytes.length, hash: originalHash, reportId: rid, revision: 1, projectId: pid }, null, 2));
    return { sourceId, originalBytes: bytes.length, originalHash, reentry: true };
  });
  await step('recipient, tenant, project, revision, uncited chunk and malformed HTTP boundaries', async () => {
    await get(sourceUrl(), 404, await jwt('3915')); await get(sourceUrl('/original'), 404, await jwt('3915'));
    await assert.rejects(() => new FollowupService({ ...actor, enterpriseId: '1455' }).knowledgeSource(bid, rid, 1, pid, sourceId));
    await get(sourceUrl('', sourceId, '1'), 404); await get(sourceUrl('', sourceId, pid, 999), 404);
    const other = await read(tx => one(tx, sql`select c.id::text from app.assistant_knowledge_chunks c where c.enterprise_id=1454 and c.document_version_id=411 order by c.ordinal limit 1`));
    assert.ok(other); await get(sourceUrl('', 'K' + other.id), 404); await get(sourceUrl('/original', 'K' + other.id), 404);
    await get(sourceUrl('', String(source.id)), 422); await get(sourceUrl() + '&revision=1', 422); await get(sourceUrl().replace('?revision=1', ''), 404);
    return { otherCustomer: 'denied excerpt/file', crossTenant: 'denied', uncitedPublishedChunk: other.id, badLocator: 'denied', newGrant: false };
  });
  await step('rollback-only source retirement/audience/hash and excluded-file guards reuse the original resolver', async () => {
    const rollback = new Error('rollback original source guard probe');
    const mutations = [
      sql`update app.assistant_knowledge_documents set status='retired' where enterprise_id=1454 and id=404`,
      sql`update app.assistant_knowledge_documents set audience='staff_internal' where enterprise_id=1454 and id=404`,
      sql`update app.assistant_knowledge_chunks set text_hash='source-probe' where enterprise_id=1454 and id=${String(source.id)}`,
    ];
    for (const mutation of mutations) await assert.rejects(() => read(async tx => {
      const c = await new AssistantRepository(tx, actor).conversation(cid); await tx.execute(mutation);
      await assert.rejects(() => reportKnowledgeSource(tx, actor, c, body, pid, sourceId));
      await assert.rejects(() => reportKnowledgeSource(tx, actor, c, body, pid, sourceId, true)); throw rollback;
    }), e => e === rollback);
    const { originalFileAllowed } = req('./src/lib/assistant/knowledge/file-service.ts');
    assert.equal(originalFileAllowed({ ...source.source_file, review: { ...source.source_file.review, excluded: ['private-page'] } }, source.locator.file), false);
    const recheck = (await get(sourceUrl())).data; assert.equal(recheck.available, true); assert.equal(recheck.originalAvailable, true);
    return { checks: 4, allRolledBack: true, originalPublicationUnchanged: true, scope: 'source guards only; not a full source-withdrawal journey or old driver replay' };
  });
  } else await step('refactored original-file disclosure guard reads actual authorized bytes without replaying the permission matrix', async () => {
    const excerpt = (await get(sourceUrl())).data; assert.equal(excerpt.available, true); assert.equal(excerpt.originalAvailable, true);
    const bytes = await get(sourceUrl('/original'), 200, token, true);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), originalHash);
    return { sourceId, originalBytes: bytes.length, originalHash, scope: 'new disclosure predicate and fresh native fixture only' };
  });
  await step('current project access revocation blocks old source and original URLs', async () => {
    try { await access(false); await get(sourceUrl(), 404); await get(sourceUrl('/original'), 404); }
    finally { await access(true); }
    assert.equal((await get(sourceUrl())).data.available, true);
    return { currentProjectGate: true, sameSavedBody: true };
  });
  if (nativePath) {
    const native = req(path.resolve(nativePath));
    ctx.report.sourceNative = await native({ ...ctx, actors: [{ uid: '3914', role: 'customer', token, bid, cid, rid }], sourceId, access });
    assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(nativePath))).digest('hex'), nativeHash);
    ctx.report.sourceNativeDriver = { path: path.relative(root, path.resolve(nativePath)), before: nativeHash, after: nativeHash };
    ctx.save();
  }
  return { sourceId, reportId: rid, revision: 1, projectId: pid, realPublishedEvidence: '404/410', originalHash, modelCalls: 0, embeddingCalls: 0, ingestionCalls: 0,
    native: nativePath ? 'see sourceNative' : 'not executed', generatedSemantics: false };
};
