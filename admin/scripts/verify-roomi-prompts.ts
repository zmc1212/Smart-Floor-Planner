import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import mongoose from 'mongoose';
import { loadEnvConfig } from '@next/env';
import { AiPromptCategory } from '../src/models/AiPromptCategory';
import { AiPromptLibraryRevision } from '../src/models/AiPromptLibraryRevision';
import { AiPromptParameterTemplate } from '../src/models/AiPromptParameterTemplate';
import { AiPromptSourceModel } from '../src/models/AiPromptSourceModel';
import { AiPromptTemplate } from '../src/models/AiPromptTemplate';
import { AiPromptTemplateAsset } from '../src/models/AiPromptTemplateAsset';
import { normalizePromptLibrarySnapshot } from '../src/lib/ai/prompt-library';
import { getMediaStorageProvider } from '../src/lib/media-storage/registry';
import type { PromptLibrarySnapshot, StagedPromptAsset } from '../src/lib/ai/prompt-library-types';

loadEnvConfig(process.cwd());

function assertCondition(condition: unknown, message: string, errors: string[]) {
  if (!condition) errors.push(message);
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  const revision = await AiPromptLibraryRevision.findOne({ source: 'roomi', status: 'active' })
    .sort({ publishedAt: -1, createdAt: -1 })
    .orFail();
  const [categories, templates, parameterTemplates, models, assets] = await Promise.all([
    AiPromptCategory.find({ importRevision: revision._id }).lean(),
    AiPromptTemplate.find({ importRevision: revision._id }).lean(),
    AiPromptParameterTemplate.find({ importRevision: revision._id }).lean(),
    AiPromptSourceModel.find({ importRevision: revision._id }).lean(),
    AiPromptTemplateAsset.find({ importRevision: revision._id }).lean(),
  ]);
  const errors: string[] = [];
  const actualCounts = {
    categories: categories.length,
    templates: templates.length,
    parameterTemplates: parameterTemplates.length,
    models: models.length,
    previewAssets: assets.length,
  };
  assertCondition(JSON.stringify(actualCounts) === JSON.stringify(revision.counts), 'Database counts do not match the active revision manifest', errors);

  for (const [label, records] of [
    ['category', categories],
    ['template', templates],
    ['parameter template', parameterTemplates],
    ['model', models],
    ['asset', assets],
  ] as const) {
    const ids = records.map((record) => record.sourceId);
    assertCondition(new Set(ids).size === ids.length, `${label} contains duplicate source IDs`, errors);
  }

  const categoryIds = new Set(categories.map((item) => item.sourceId));
  const parameterIds = new Set(parameterTemplates.map((item) => item.sourceId));
  const modelIds = new Set(models.map((item) => item.sourceId));
  const assetIds = new Set(assets.map((item) => String(item._id)));
  for (const category of categories) {
    assertCondition(!category.parentSourceId || categoryIds.has(category.parentSourceId), `Category ${category.sourceId} has an orphan parent`, errors);
    assertCondition(category.level >= 1 && category.level <= 3, `Category ${category.sourceId} has invalid level ${category.level}`, errors);
  }
  for (const template of templates) {
    assertCondition(Boolean(template.promptContent.trim()), `Template ${template.sourceId} has an empty prompt`, errors);
    assertCondition(categoryIds.has(template.categorySourceId), `Template ${template.sourceId} has an invalid category`, errors);
    assertCondition(!template.parameterTemplateSourceId || parameterIds.has(template.parameterTemplateSourceId), `Template ${template.sourceId} has an invalid parameter template`, errors);
    assertCondition(!template.bestModelSourceId || modelIds.has(template.bestModelSourceId), `Template ${template.sourceId} has an invalid recommended model`, errors);
    assertCondition(Boolean(template.previewAssetId && assetIds.has(String(template.previewAssetId))), `Template ${template.sourceId} has no local preview asset`, errors);
  }
  assertCondition(assets.every((asset) => asset.storageProvider === 'local'), 'At least one active preview asset is not stored locally', errors);

  const manifestPath = revision.snapshotPath;
  assertCondition(Boolean(manifestPath), 'Active revision does not reference an import manifest', errors);
  let sourceChecks = { sampledTemplates: 0, sampledRootCategories: 0 };
  let assetIndex = new Map<string, StagedPromptAsset>();
  if (manifestPath) {
    const directory = path.dirname(manifestPath);
    const snapshot = JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'), 'utf8')) as PromptLibrarySnapshot;
    const normalized = normalizePromptLibrarySnapshot(snapshot);
    const sourceById = new Map(normalized.templates.map((template) => [template.sourceId, template]));
    const databaseById = new Map(templates.map((template) => [template.sourceId, template]));
    const deterministicTwenty = [...normalized.templates].sort((left, right) => left.sourceHash.localeCompare(right.sourceHash)).slice(0, 20);
    const rootCategories = normalized.categories.filter((category) => category.level === 1);
    const descendantsByRoot = new Map<string, Set<string>>();
    for (const root of rootCategories) {
      const ids = new Set([root.sourceId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of normalized.categories) {
          if (category.parentSourceId && ids.has(category.parentSourceId) && !ids.has(category.sourceId)) {
            ids.add(category.sourceId);
            changed = true;
          }
        }
      }
      descendantsByRoot.set(root.sourceId, ids);
    }
    const rootSamples = rootCategories
      .map((root) => normalized.templates.find((template) => descendantsByRoot.get(root.sourceId)?.has(template.categorySourceId)))
      .filter((template): template is NonNullable<typeof template> => Boolean(template));
    const samples = new Map([...deterministicTwenty, ...rootSamples].map((template) => [template.sourceId, template]));
    for (const [sourceId, source] of samples) {
      const database = databaseById.get(sourceId);
      assertCondition(Boolean(database), `Sampled template ${sourceId} is missing from the database`, errors);
      if (!database) continue;
      assertCondition(database.name === source.name, `Sampled template ${sourceId} name mismatch`, errors);
      assertCondition(database.promptContent === source.promptContent, `Sampled template ${sourceId} prompt mismatch`, errors);
      assertCondition(database.weight === source.weight, `Sampled template ${sourceId} weight mismatch`, errors);
      assertCondition(database.sourceHash === source.sourceHash, `Sampled template ${sourceId} source hash mismatch`, errors);
    }
    sourceChecks = { sampledTemplates: samples.size, sampledRootCategories: rootSamples.length };
    const stagedAssets = JSON.parse(await fs.readFile(path.join(directory, 'assets', 'index.json'), 'utf8')) as StagedPromptAsset[];
    assetIndex = new Map(stagedAssets.map((asset) => [asset.templateSourceId, asset]));
    assertCondition(normalized.templates.length === templates.length, 'Filtered source template count does not match database', errors);
    assertCondition(normalized.skippedTemplates.length === 8, 'Expected exactly 8 templates skipped for missing bestModelId', errors);
    assertCondition(sourceById.size === databaseById.size, 'Source and database template ID sets differ', errors);
  }

  const provider = await getMediaStorageProvider('local');
  let verifiedBytes = 0;
  let verifiedAssets = 0;
  for (const asset of assets) {
    const buffer = await provider.getObject({ objectKey: asset.storageKey, bucket: asset.storageBucket });
    verifiedBytes += buffer.length;
    verifiedAssets += 1;
    assertCondition(buffer.length === asset.size, `Asset ${asset.sourceId} size mismatch`, errors);
    assertCondition(sha256(buffer) === asset.checksumSha256, `Asset ${asset.sourceId} checksum mismatch`, errors);
    const staged = assetIndex.get(asset.templateSourceId);
    assertCondition(!staged || staged.checksumSha256 === asset.checksumSha256, `Asset ${asset.sourceId} differs from staged source`, errors);
  }

  const report = {
    success: errors.length === 0,
    revisionId: String(revision._id),
    revisionKey: revision.revisionKey,
    counts: actualCounts,
    skippedTemplates: 8,
    sourceChecks,
    media: { provider: 'local', verifiedAssets, verifiedBytes },
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[Prompt Library Verify]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect().catch(() => undefined);
});
