import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { aiProviderConfigs, platformConfigs } from '@/db/schema';
import { withPlatformTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { savePlatformLlmConfig, getPlatformLlmConfig } from '@/lib/platform-llm-config';

/** Caller holds the existing isolated acceptance lock. No production/main DB,
 * credential output, provider fallback, or account quota setting changes. */
export async function bindBailianReviewTestRuntime(root: string, output: string) {
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname) && database.port === '55432'
    && database.pathname === '/xiaok_embedding_eval');
  const keys = ['llm-settings-override', 'vlm-settings-override'];
  const snapshot = await withPlatformTransaction(async tx => ({
    config: (await tx.select().from(platformConfigs).where(eq(platformConfigs.key, 'default')))[0],
    providers: await tx.select().from(aiProviderConfigs).where(inArray(aiProviderConfigs.key, keys)),
  }));
  assert.ok(snapshot.config && snapshot.providers.some(p => p.key === keys[0]), 'Existing isolated LLM projection required');
  const hash = () => withPlatformTransaction(async tx => ({
    config: await rows(tx, sql`select key,md5(to_jsonb(p)::text) hash from app.platform_configs p where key='default'`),
    providers: await rows(tx, sql`select key,md5(to_jsonb(p)::text) hash from app.ai_provider_configs p
      where key in ('llm-settings-override','vlm-settings-override') order by key`),
  }));
  const before = await hash();
  const snapshotFile = output.replace(/\.json$/, '.configuration-snapshot.private.json');
  // Product-encrypted records only, retained for crash recovery; no plaintext key.
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  let restored = false;
  const restore = async () => {
    if (!restored) {
      await withPlatformTransaction(async tx => {
        await tx.update(platformConfigs).set({ llmConfig: snapshot.config.llmConfig, updatedAt: snapshot.config.updatedAt })
          .where(eq(platformConfigs.id, snapshot.config.id));
        for (const key of keys) {
          const original = snapshot.providers.find(p => p.key === key);
          if (original) {
            const { id: originalId, ...values } = original;
            await tx.update(aiProviderConfigs).set(values).where(eq(aiProviderConfigs.id, originalId));
          }
          else await tx.delete(aiProviderConfigs).where(eq(aiProviderConfigs.key, key));
        }
      });
      const after = await hash(); assert.deepEqual(after, before, 'Isolated configuration/projection restoration mismatch');
      fs.rmSync(snapshotFile, { force: true });
      restored = true;
    }
    return { restored, original: before };
  };
  try {
    const source = path.join(root, 'tmp/xiaok-intelligent-consult/.env.qwen37');
    const { readCredential } = await import(pathToFileURL(path.join(root, 'tmp/xiaok-intelligent-consult/openwebui-qwen37-cost.mjs')).href);
    const credential = readCredential(source);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-d1-resume-20261027/bailian-catalog.json'), 'utf8'));
    assert.equal(catalog.status, 200); assert.equal(catalog.offered, true); assert.equal(catalog.targetModel, 'qwen3.8-flash');
    assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'), catalog.sourceHash);
    await savePlatformLlmConfig({ enabled: true, providerKey: 'dashscope', baseUrl: credential.baseUrl,
      model: 'qwen3.8-flash', apiKey: credential.apiKey });
    const config = await getPlatformLlmConfig();
    assert.equal(config.providerKey, 'dashscope'); assert.equal(config.model, 'qwen3.8-flash'); assert.equal(config.available, true);
    return { restore, receipt: { providerKey: config.providerKey, model: config.model, baseUrl: config.baseUrl,
      sourceHash: catalog.sourceHash, settingsScope: 'isolated acceptance only', original: before } };
  } catch (error) { await restore(); throw error; }
}
