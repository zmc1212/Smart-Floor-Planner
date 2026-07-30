import mongoose from 'mongoose';
import { AiPromptCategory } from '@/models/AiPromptCategory';
import { AiPromptTemplate } from '@/models/AiPromptTemplate';
import { AiPromptTemplateAsset } from '@/models/AiPromptTemplateAsset';
import { AiPromptSourceModel } from '@/models/AiPromptSourceModel';
import { getActivePromptLibraryRevision } from './prompt-library-import';

export function escapeMongoRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function previewUrl(templateId: unknown) {
  return `/api/ai/creation/prompt-templates/${String(templateId)}/preview`;
}

export async function requireActivePromptLibraryRevision() {
  const revision = await getActivePromptLibraryRevision();
  if (!revision) throw new Error('Prompt library has not been published');
  return revision;
}

export async function listActivePromptCategories() {
  const revision = await requireActivePromptLibraryRevision();
  const categories = await AiPromptCategory.find({ importRevision: revision._id, enabled: true })
    .sort({ level: 1, weight: -1, sourceId: 1 })
    .select('sourceId parentSourceId level name weight')
    .lean();
  return {
    revisionId: String(revision._id),
    revisionKey: revision.revisionKey,
    categories: categories.map((category) => ({
      id: String(category._id),
      sourceId: category.sourceId,
      parentSourceId: category.parentSourceId,
      level: category.level,
      name: category.name,
      weight: category.weight,
    })),
  };
}

async function categorySourceIdsForFilter(revisionId: mongoose.Types.ObjectId, sourceId: string) {
  const categories = await AiPromptCategory.find({ importRevision: revisionId, enabled: true })
    .select('sourceId parentSourceId')
    .lean();
  const selected = new Set([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentSourceId && selected.has(category.parentSourceId) && !selected.has(category.sourceId)) {
        selected.add(category.sourceId);
        changed = true;
      }
    }
  }
  return [...selected];
}

export async function listActivePromptTemplates(input: {
  page?: number;
  limit?: number;
  query?: string;
  categorySourceId?: string;
}) {
  const revision = await requireActivePromptLibraryRevision();
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 24));
  const filter: Record<string, unknown> = { importRevision: revision._id, enabled: true };
  const query = input.query?.trim();
  if (query) {
    const regex = new RegExp(escapeMongoRegex(query), 'i');
    filter.$or = [{ name: regex }, { promptContent: regex }];
  }
  if (input.categorySourceId?.trim()) {
    filter.categorySourceId = {
      $in: await categorySourceIdsForFilter(revision._id, input.categorySourceId.trim()),
    };
  }

  const [templates, total] = await Promise.all([
    AiPromptTemplate.find(filter)
      .sort({ weight: -1, sourceId: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name promptContent categorySourceId bestModelSourceId parameterTemplateSourceId adaptationModel previewAssetId weight')
      .lean(),
    AiPromptTemplate.countDocuments(filter),
  ]);
  const previewAssetIds = templates
    .map((template) => template.previewAssetId)
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const previewAssets = await AiPromptTemplateAsset.find({
    _id: { $in: previewAssetIds },
    importRevision: revision._id,
  }).select('_id sourceUrl').lean();
  const previewSourceById = new Map(previewAssets.map((asset) => [String(asset._id), asset.sourceUrl]));
  const modelSourceIds = templates
    .map((template) => template.bestModelSourceId)
    .filter((id): id is string => Boolean(id));
  const sourceModels = await AiPromptSourceModel.find({
    sourceId: { $in: modelSourceIds },
    importRevision: revision._id,
  }).select('sourceId localModelProfileId').lean();
  const profileBySourceId = new Map(sourceModels.map((model) => [model.sourceId, model.localModelProfileId]));
  return {
    revisionId: String(revision._id),
    items: templates.map((template) => ({
      id: String(template._id),
      name: template.name,
      promptContent: template.promptContent,
      categorySourceId: template.categorySourceId,
      bestModelSourceId: template.bestModelSourceId,
      recommendedModelProfileId: template.bestModelSourceId
        ? String(profileBySourceId.get(template.bestModelSourceId) || '') || undefined
        : undefined,
      parameterTemplateSourceId: template.parameterTemplateSourceId,
      adaptationModel: template.adaptationModel,
      weight: template.weight,
      previewUrl: template.previewAssetId
        ? previewSourceById.get(String(template.previewAssetId)) || previewUrl(template._id)
        : undefined,
      localPreviewUrl: template.previewAssetId ? previewUrl(template._id) : undefined,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getActivePromptTemplate(templateId: string) {
  if (!mongoose.isValidObjectId(templateId)) return null;
  const revision = await requireActivePromptLibraryRevision();
  const template = await AiPromptTemplate.findOne({
    _id: templateId,
    importRevision: revision._id,
    enabled: true,
  })
    .populate('parameterTemplateId', 'name parameters adaptationModel')
    .populate('sourceModelId', 'name modelCode localModelProfileId capabilities')
    .select('name promptContent categorySourceId bestModelSourceId parameterTemplateSourceId adaptationModel previewAssetId weight parameterTemplateId sourceModelId')
    .lean();
  if (!template) return null;
  const previewAsset = template.previewAssetId
    ? await AiPromptTemplateAsset.findOne({ _id: template.previewAssetId, importRevision: revision._id })
      .select('sourceUrl')
      .lean()
    : null;
  return {
    id: String(template._id),
    name: template.name,
    promptContent: template.promptContent,
    categorySourceId: template.categorySourceId,
    bestModelSourceId: template.bestModelSourceId,
    parameterTemplateSourceId: template.parameterTemplateSourceId,
    adaptationModel: template.adaptationModel,
    weight: template.weight,
    previewUrl: template.previewAssetId ? previewAsset?.sourceUrl || previewUrl(template._id) : undefined,
    localPreviewUrl: template.previewAssetId ? previewUrl(template._id) : undefined,
    parameterTemplate: template.parameterTemplateId || undefined,
    recommendedModel: template.sourceModelId || undefined,
    recommendedModelProfileId: template.sourceModelId && 'localModelProfileId' in template.sourceModelId
      ? String(template.sourceModelId.localModelProfileId || '') || undefined
      : undefined,
  };
}

export async function getActivePromptTemplateAsset(templateId: string) {
  if (!mongoose.isValidObjectId(templateId)) return null;
  const revision = await requireActivePromptLibraryRevision();
  const template = await AiPromptTemplate.findOne({
    _id: templateId,
    importRevision: revision._id,
    enabled: true,
  }).select('previewAssetId').lean();
  if (!template?.previewAssetId) return null;
  return AiPromptTemplateAsset.findOne({
    _id: template.previewAssetId,
    importRevision: revision._id,
  });
}
