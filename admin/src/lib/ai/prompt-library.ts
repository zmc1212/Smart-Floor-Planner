import crypto from 'crypto';
import type {
  NormalizedPromptCategory,
  NormalizedPromptLibrary,
  PromptLibrarySnapshot,
  PromptLibraryValidation,
  SourceRecord,
  StagedPromptAsset,
} from './prompt-library-types';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Value(value: unknown) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function asSourceId(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (['true', '1', 'yes', 'enabled'].includes(value.trim().toLowerCase())) return true;
    if (['false', '0', 'no', 'disabled'].includes(value.trim().toLowerCase())) return false;
  }
  return fallback;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(asText).filter(Boolean);
  } catch {
    // The source also uses comma-delimited model lists.
  }
  return trimmed.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function sourceRecord(value: unknown): SourceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Prompt library record must be an object');
  }
  return value as SourceRecord;
}

function rootParentId(value: unknown) {
  const id = asSourceId(value);
  return !id || id === '0' || id.toLowerCase() === 'null' ? undefined : id;
}

function resolveCategoryLevels(categories: Array<Omit<NormalizedPromptCategory, 'level'>>) {
  const byId = new Map(categories.map((item) => [item.sourceId, item]));
  const cache = new Map<string, number>();

  const resolve = (sourceId: string, trail = new Set<string>()): number => {
    const cached = cache.get(sourceId);
    if (cached) return cached;
    if (trail.has(sourceId)) throw new Error(`Category cycle detected at sourceId=${sourceId}`);
    const category = byId.get(sourceId);
    if (!category) return 1;
    if (!category.parentSourceId) {
      cache.set(sourceId, 1);
      return 1;
    }
    trail.add(sourceId);
    const level = resolve(category.parentSourceId, trail) + 1;
    trail.delete(sourceId);
    cache.set(sourceId, level);
    return level;
  };

  return categories.map((category) => ({ ...category, level: resolve(category.sourceId) }));
}

export function normalizePromptLibrarySnapshot(snapshot: PromptLibrarySnapshot): NormalizedPromptLibrary {
  const rawCategories = snapshot.categories.map(sourceRecord).map((record) => ({
    sourceId: asSourceId(record.modelPromptCategoryId ?? record.id),
    parentSourceId: rootParentId(record.parentId),
    name: asText(record.categoryName ?? record.name),
    weight: asNumber(record.weight),
    enabled: asBoolean(record.isEnable ?? record.enabled),
    sourcePayload: record,
    sourceHash: sha256Value(record),
  }));

  const categories = resolveCategoryLevels(rawCategories);
  const parameterTemplates = snapshot.parameterTemplates.map(sourceRecord).map((record) => ({
    sourceId: asSourceId(record.modelParamTemplateId ?? record.id),
    name: asText(record.modelParamTemplateName ?? record.paramTemplateName ?? record.templateName ?? record.name) || '未命名参数模板',
    adaptationModel: asStringArray(record.adaptationModel),
    parameters: record,
    weight: asNumber(record.weight),
    enabled: asBoolean(record.isEnable ?? record.enabled),
    sourcePayload: record,
    sourceHash: sha256Value(record),
  }));

  const models = snapshot.models.map(sourceRecord).map((record) => ({
    sourceId: asSourceId(record.modelId ?? record.id),
    name: asText(record.modelName ?? record.name) || '未命名模型',
    modelCode: asText(record.modelCode ?? record.modelKey ?? record.apiModelName) || undefined,
    capabilities: record,
    weight: asNumber(record.weight),
    enabled: asBoolean(record.isEnable ?? record.enabled),
    sourcePayload: record,
    sourceHash: sha256Value(record),
  }));

  const sourceTemplates = snapshot.templates.map(sourceRecord).map((record) => ({
    sourceId: asSourceId(record.modelPromptId ?? record.id),
    name: asText(record.promptName ?? record.name),
    promptContent: asText(record.promptContent ?? record.prompt),
    categorySourceId: asSourceId(record.modelPromptCategoryId ?? record.categoryId),
    bestModelSourceId: asSourceId(record.bestModelId) || undefined,
    parameterTemplateSourceId: asSourceId(record.modelParamTemplateId) || undefined,
    adaptationModel: asStringArray(record.adaptationModel),
    previewSourceUrl: asText(record.styleImage) || undefined,
    weight: asNumber(record.weight),
    enabled: asBoolean(record.isEnable ?? record.enabled),
    sourcePayload: record,
    sourceHash: sha256Value(record),
  }));

  const modelIds = new Set(models.map((model) => model.sourceId));
  const skippedTemplates = sourceTemplates
    .filter((template) => template.bestModelSourceId && !modelIds.has(template.bestModelSourceId))
    .map((template) => ({
      sourceId: template.sourceId,
      bestModelSourceId: template.bestModelSourceId as string,
      reason: 'missing_recommended_model' as const,
      sourceHash: template.sourceHash,
    }));
  const skippedIds = new Set(skippedTemplates.map((template) => template.sourceId));
  const templates = sourceTemplates.filter((template) => !skippedIds.has(template.sourceId));

  return { categories, templates, parameterTemplates, models, skippedTemplates };
}

function duplicateIds(records: Array<{ sourceId: string }>) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.sourceId)) duplicates.add(record.sourceId);
    seen.add(record.sourceId);
  }
  return [...duplicates].sort();
}

export function validatePromptLibrary(
  library: NormalizedPromptLibrary,
  assets: StagedPromptAsset[] = []
): PromptLibraryValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const categoryIds = new Set(library.categories.map((item) => item.sourceId));
  const parameterIds = new Set(library.parameterTemplates.map((item) => item.sourceId));
  const modelIds = new Set(library.models.map((item) => item.sourceId));
  const assetsByTemplate = new Map(assets.map((asset) => [asset.templateSourceId, asset]));

  for (const [label, records] of [
    ['category', library.categories],
    ['template', library.templates],
    ['parameter template', library.parameterTemplates],
    ['model', library.models],
  ] as const) {
    const missing = records.filter((item) => !item.sourceId).length;
    if (missing) errors.push(`${label}: ${missing} record(s) have an empty sourceId`);
    const duplicates = duplicateIds(records);
    if (duplicates.length) errors.push(`${label}: duplicate sourceId(s): ${duplicates.join(', ')}`);
  }

  for (const category of library.categories) {
    if (!category.name) errors.push(`category ${category.sourceId}: empty name`);
    if (category.parentSourceId && !categoryIds.has(category.parentSourceId)) {
      errors.push(`category ${category.sourceId}: missing parent ${category.parentSourceId}`);
    }
    if (category.level > 3) errors.push(`category ${category.sourceId}: level ${category.level} exceeds 3`);
  }

  for (const template of library.templates) {
    if (!template.name) errors.push(`template ${template.sourceId}: empty name`);
    if (template.enabled && !template.promptContent) errors.push(`template ${template.sourceId}: empty promptContent`);
    if (!categoryIds.has(template.categorySourceId)) {
      errors.push(`template ${template.sourceId}: missing category ${template.categorySourceId}`);
    }
    if (template.parameterTemplateSourceId && !parameterIds.has(template.parameterTemplateSourceId)) {
      errors.push(`template ${template.sourceId}: missing parameter template ${template.parameterTemplateSourceId}`);
    }
    if (template.bestModelSourceId && !modelIds.has(template.bestModelSourceId)) {
      errors.push(`template ${template.sourceId}: missing recommended model ${template.bestModelSourceId}`);
    }
    if (template.previewSourceUrl && !assetsByTemplate.has(template.sourceId)) {
      errors.push(`template ${template.sourceId}: preview image was not staged`);
    }
  }

  for (const asset of assets) {
    if (!asset.mimeType.startsWith('image/')) errors.push(`asset ${asset.templateSourceId}: invalid MIME ${asset.mimeType}`);
    if (!(asset.width > 0 && asset.height > 0 && asset.size > 0)) {
      errors.push(`asset ${asset.templateSourceId}: invalid dimensions or size`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.checksumSha256)) {
      errors.push(`asset ${asset.templateSourceId}: invalid SHA-256`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: {
      categories: library.categories.length,
      templates: library.templates.length,
      parameterTemplates: library.parameterTemplates.length,
      models: library.models.length,
      previewAssets: assets.length,
    },
  };
}

export type ListPage = { records: SourceRecord[]; total?: number };

export function extractListPage(payload: unknown): ListPage {
  const root = sourceRecord(payload);
  const dataValue = root.data;
  const data = dataValue && typeof dataValue === 'object' && !Array.isArray(dataValue)
    ? dataValue as SourceRecord
    : undefined;
  const candidates = [data?.records, data?.rows, data?.list, dataValue, root.records, root.rows, root.list];
  const recordsValue = candidates.find(Array.isArray);
  const records = (recordsValue || []).map(sourceRecord);
  const totalValue = data?.total ?? data?.totalCount ?? root.total ?? root.totalCount;
  const total = Number(totalValue);
  return { records, total: Number.isFinite(total) && total >= 0 ? total : undefined };
}

export async function paginateSourceRecords(input: {
  pageSize: number;
  fetchPage: (pageNo: number, pageSize: number) => Promise<unknown>;
  maxPages?: number;
}) {
  const records: SourceRecord[] = [];
  const pageHashes = new Set<string>();
  const maxPages = input.maxPages ?? 10_000;
  let expectedTotal: number | undefined;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page = extractListPage(await input.fetchPage(pageNo, input.pageSize));
    if (page.total !== undefined) expectedTotal = page.total;
    const pageHash = sha256Value(page.records);
    if (page.records.length && pageHashes.has(pageHash)) {
      throw new Error(`Pagination repeated page content at page ${pageNo}`);
    }
    pageHashes.add(pageHash);
    records.push(...page.records);
    if (expectedTotal !== undefined && records.length >= expectedTotal) break;
    if (page.records.length < input.pageSize) break;
  }

  if (expectedTotal !== undefined && records.length !== expectedTotal) {
    throw new Error(`Pagination count mismatch: expected ${expectedTotal}, received ${records.length}`);
  }
  return { records, total: expectedTotal ?? records.length };
}

export function sanitizeImportError(error: unknown, secrets: Array<string | undefined>) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

export function isSuccessfulPromptSourceStatusCode(value: unknown) {
  const statusCode = Number(value ?? 200);
  return statusCode === 200 || statusCode === 20000;
}
