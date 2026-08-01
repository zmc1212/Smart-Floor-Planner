import {
  PromptLibraryRepository,
  type PromptCategoryRecord,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export function escapeMongoRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePostgresId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  return BigInt(value);
}

function previewUrl(templateId: bigint) {
  return `/api/ai/creation/prompt-templates/${String(templateId)}/preview`;
}

function descendantCategorySourceIds(
  categories: PromptCategoryRecord[],
  sourceId: string
) {
  const selected = new Set([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (
        category.parentSourceId &&
        selected.has(category.parentSourceId) &&
        !selected.has(category.sourceId)
      ) {
        selected.add(category.sourceId);
        changed = true;
      }
    }
  }
  return [...selected];
}

export async function requireActivePromptLibraryRevision() {
  return withPlatformTransaction(async (transaction) => {
    const revision = await new PromptLibraryRepository(
      transaction
    ).findActiveRevision();
    if (!revision) throw new Error('Prompt library has not been published');
    return revision;
  });
}

export async function listActivePromptCategories() {
  return withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision();
    if (!revision) throw new Error('Prompt library has not been published');
    const categories = await repository.listCategories(revision.id);
    return {
      revisionId: String(revision.id),
      revisionKey: revision.revisionKey,
      categories: categories.map((category) => ({
        id: String(category.id),
        sourceId: category.sourceId,
        parentSourceId: category.parentSourceId,
        level: category.level,
        name: category.name,
        weight: category.weight,
      })),
    };
  });
}

export async function listActivePromptTemplates(input: {
  page?: number;
  limit?: number;
  query?: string;
  categorySourceId?: string;
}) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 24));
  return withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision();
    if (!revision) throw new Error('Prompt library has not been published');

    const categories = await repository.listCategories(revision.id);
    const categorySourceIds = input.categorySourceId?.trim()
      ? descendantCategorySourceIds(categories, input.categorySourceId.trim())
      : undefined;
    const { rows: templates, total } = await repository.listTemplates(
      revision.id,
      {
        page,
        limit,
        query: input.query?.trim()
          ? input.query.trim().replace(/[\\%_]/g, '\\$&')
          : undefined,
        categorySourceIds,
      }
    );

    const modelSourceIds = templates
      .map((template) => template.bestModelSourceId)
      .filter((id): id is string => Boolean(id));
    const sourceModels = await repository.listSourceModels(
      revision.id,
      modelSourceIds
    );
    const profileBySourceId = new Map(
      sourceModels.map((model) => [model.sourceId, model.localModelProfileId])
    );

    const previewAssets = await repository.listTemplateAssets(
      revision.id,
      templates
        .map((template) => template.previewAssetId)
        .filter((id): id is bigint => id !== null)
    );
    const previewSourceById = new Map(
      previewAssets.map((asset) => [String(asset.id), asset.sourceUrl])
    );

    return {
      revisionId: String(revision.id),
      items: templates.map((template) => ({
        id: String(template.id),
        name: template.name,
        promptContent: template.promptContent,
        categorySourceId: template.categorySourceId,
        bestModelSourceId: template.bestModelSourceId,
        recommendedModelProfileId: template.bestModelSourceId
          ? String(profileBySourceId.get(template.bestModelSourceId) || '') ||
            undefined
          : undefined,
        parameterTemplateSourceId: template.parameterTemplateSourceId,
        adaptationModel: template.adaptationModel,
        weight: template.weight,
        previewUrl: template.previewAssetId
          ? previewSourceById.get(String(template.previewAssetId)) ||
            previewUrl(template.id)
          : undefined,
        localPreviewUrl: template.previewAssetId
          ? previewUrl(template.id)
          : undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });
}

export async function getActivePromptTemplate(templateId: string) {
  const parsedId = parsePostgresId(templateId);
  if (!parsedId) return null;
  return withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision();
    if (!revision) throw new Error('Prompt library has not been published');
    const template = await repository.findTemplate(revision.id, parsedId);
    if (!template) return null;

    const [previewAsset, parameterTemplate, sourceModel] = await Promise.all([
      repository.findTemplateAsset(revision.id, template.previewAssetId),
      repository.findParameterTemplate(
        revision.id,
        template.parameterTemplateId
      ),
      repository.findSourceModel(revision.id, template.sourceModelId),
    ]);

    return {
      id: String(template.id),
      name: template.name,
      promptContent: template.promptContent,
      categorySourceId: template.categorySourceId,
      bestModelSourceId: template.bestModelSourceId,
      parameterTemplateSourceId: template.parameterTemplateSourceId,
      adaptationModel: template.adaptationModel,
      weight: template.weight,
      previewUrl: template.previewAssetId
        ? previewAsset?.sourceUrl || previewUrl(template.id)
        : undefined,
      localPreviewUrl: template.previewAssetId
        ? previewUrl(template.id)
        : undefined,
      parameterTemplate: parameterTemplate
        ? {
            _id: String(parameterTemplate.id),
            name: parameterTemplate.name,
            parameters: parameterTemplate.parameters,
            adaptationModel: parameterTemplate.adaptationModel,
          }
        : undefined,
      recommendedModel: sourceModel
        ? {
            _id: String(sourceModel.id),
            name: sourceModel.name,
            modelCode: sourceModel.modelCode,
            capabilities: sourceModel.capabilities,
            localModelProfileId: sourceModel.localModelProfileId
              ? String(sourceModel.localModelProfileId)
              : undefined,
          }
        : undefined,
      recommendedModelProfileId: sourceModel?.localModelProfileId
        ? String(sourceModel.localModelProfileId)
        : undefined,
    };
  });
}

export async function getActivePromptTemplateAsset(templateId: string) {
  const parsedId = parsePostgresId(templateId);
  if (!parsedId) return null;
  return withPlatformTransaction(async (transaction) => {
    const repository = new PromptLibraryRepository(transaction);
    const revision = await repository.findActiveRevision();
    if (!revision) throw new Error('Prompt library has not been published');
    const template = await repository.findTemplate(revision.id, parsedId);
    if (!template) return null;
    return repository.findTemplateAsset(revision.id, template.previewAssetId);
  });
}
