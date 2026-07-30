import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractListPage,
  isSuccessfulPromptSourceStatusCode,
  normalizePromptLibrarySnapshot,
  paginateSourceRecords,
  sanitizeImportError,
  validatePromptLibrary,
} from '../prompt-library';
import { createPromptLibraryRevisionIdentity } from '../prompt-library-import';
import { rollbackPromptLibraryRevision } from '../prompt-library-import';
import { escapeMongoRegex } from '../prompt-library-query';
import { AiPromptLibraryRevision } from '@/models/AiPromptLibraryRevision';
import type { PromptLibrarySnapshot, StagedPromptAsset } from '../prompt-library-types';

const snapshot: PromptLibrarySnapshot = {
  categories: [
    { modelPromptCategoryId: 1, parentId: 0, categoryName: '一级', weight: 20, isEnable: true },
    { modelPromptCategoryId: 2, parentId: 1, categoryName: '二级', weight: 10, isEnable: true },
    { modelPromptCategoryId: 3, parentId: 2, categoryName: '三级', weight: 5, isEnable: true },
  ],
  templates: [{
    modelPromptId: 10,
    modelPromptCategoryId: 3,
    promptName: '测试模板',
    promptContent: '生成一张现代客厅效果图',
    styleImage: 'https://assets.example.test/preview.png',
    bestModelId: 30,
    modelParamTemplateId: 20,
    adaptationModel: '["30"]',
    weight: 99,
    isEnable: true,
  }],
  parameterTemplates: [{ modelParamTemplateId: 20, templateName: '高清方图', width: 1024, height: 1024 }],
  models: [{ modelId: 30, modelName: 'Image Model', isEnable: true }],
};

const stagedAsset: StagedPromptAsset = {
  templateSourceId: '10',
  sourceUrl: 'https://assets.example.test/preview.png',
  filePath: '/tmp/preview.png',
  mimeType: 'image/png',
  extension: 'png',
  size: 100,
  width: 64,
  height: 64,
  checksumSha256: 'a'.repeat(64),
};

test('extractListPage accepts Java-style records envelope', () => {
  assert.deepEqual(extractListPage({ data: { records: [{ id: 1 }], total: 1 } }), {
    records: [{ id: 1 }],
    total: 1,
  });
});

test('source envelope accepts both documented Roomi success codes', () => {
  assert.equal(isSuccessfulPromptSourceStatusCode(200), true);
  assert.equal(isSuccessfulPromptSourceStatusCode(20000), true);
  assert.equal(isSuccessfulPromptSourceStatusCode(50000), false);
});

test('paginateSourceRecords stops at the exact server total', async () => {
  const pages = [
    { data: { records: [{ id: 1 }, { id: 2 }], total: 3 } },
    { data: { records: [{ id: 3 }], total: 3 } },
  ];
  const result = await paginateSourceRecords({
    pageSize: 2,
    fetchPage: async (pageNo) => pages[pageNo - 1],
  });
  assert.equal(result.total, 3);
  assert.deepEqual(result.records.map((record) => record.id), [1, 2, 3]);
});

test('paginateSourceRecords rejects a repeated page to avoid infinite imports', async () => {
  await assert.rejects(
    paginateSourceRecords({
      pageSize: 1,
      fetchPage: async () => ({ data: { records: [{ id: 1 }] } }),
      maxPages: 3,
    }),
    /repeated page content/
  );
});

test('normalization preserves three category levels and source metadata', () => {
  const library = normalizePromptLibrarySnapshot(snapshot);
  assert.deepEqual(library.categories.map((item) => item.level), [1, 2, 3]);
  assert.equal(library.templates[0].promptContent, '生成一张现代客厅效果图');
  assert.equal(library.templates[0].parameterTemplateSourceId, '20');
  assert.equal(library.templates[0].bestModelSourceId, '30');
});

test('validation enforces prompt, hierarchy, references, and local preview staging', () => {
  const library = normalizePromptLibrarySnapshot(snapshot);
  assert.equal(validatePromptLibrary(library, [stagedAsset]).valid, true);

  library.templates[0].promptContent = '';
  library.templates[0].parameterTemplateSourceId = 'missing';
  const invalid = validatePromptLibrary(library, []);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('\n'), /empty promptContent/);
  assert.match(invalid.errors.join('\n'), /missing parameter template/);
  assert.match(invalid.errors.join('\n'), /preview image was not staged/);
});

test('a template with a missing bestModelId is removed from the import revision', () => {
  const source = structuredClone(snapshot);
  source.templates[0].bestModelId = 'retired-model';
  const library = normalizePromptLibrarySnapshot(source);
  assert.equal(library.templates.length, 0);
  assert.deepEqual(library.skippedTemplates, [{
    sourceId: '10',
    bestModelSourceId: 'retired-model',
    reason: 'missing_recommended_model',
    sourceHash: library.skippedTemplates[0].sourceHash,
  }]);
});

test('revision identity is deterministic for idempotent re-imports', () => {
  const first = createPromptLibraryRevisionIdentity(normalizePromptLibrarySnapshot(snapshot), [stagedAsset]);
  const second = createPromptLibraryRevisionIdentity(normalizePromptLibrarySnapshot(structuredClone(snapshot)), [
    structuredClone(stagedAsset),
  ]);
  assert.equal(first.revisionKey, second.revisionKey);
  assert.equal(first.manifestHash, second.manifestHash);
});

test('authorization and cookie values are redacted from errors', () => {
  const authorization = 'Bearer sensitive-token';
  const cookie = 'session=sensitive-cookie';
  const message = sanitizeImportError(
    new Error(`request failed ${authorization}; ${cookie}`),
    [authorization, cookie]
  );
  assert.equal(message.includes('sensitive-token'), false);
  assert.equal(message.includes('sensitive-cookie'), false);
  assert.match(message, /\[REDACTED\]/);
});

test('search input is escaped before building a Mongo regex', () => {
  assert.equal(escapeMongoRegex('客厅 (A+B).*'), '客厅 \\(A\\+B\\)\\.\\*');
});

test('rollback publishes the selected complete revision before retiring the current one', async () => {
  const model = AiPromptLibraryRevision as unknown as Record<string, unknown>;
  const originals = {
    findById: model.findById,
    findOne: model.findOne,
    updateOne: model.updateOne,
    updateMany: model.updateMany,
  };
  const operations: string[] = [];
  const target = {
    _id: 'target',
    status: 'superseded',
    revisionKey: 'roomi-target',
    orFail: async () => target,
  };
  const current = { _id: 'current', status: 'active' };
  try {
    model.findById = () => target;
    model.findOne = () => ({ sort: async () => current });
    model.updateOne = async (filter: { _id: string }, update: { $set: { status: string } }) => {
      operations.push(`one:${filter._id}:${update.$set.status}`);
    };
    model.updateMany = async () => {
      operations.push('many:superseded');
    };
    await rollbackPromptLibraryRevision('target');
    assert.deepEqual(operations, [
      'one:target:active',
      'many:superseded',
      'one:current:rolled_back',
    ]);
  } finally {
    model.findById = originals.findById;
    model.findOne = originals.findOne;
    model.updateOne = originals.updateOne;
    model.updateMany = originals.updateMany;
  }
});
