import {
  getActivePromptTemplate,
  listActivePromptCategories,
  listActivePromptTemplates,
} from '@/lib/ai/prompt-library-query';
import { resolveMiniRecipePreviewUrl } from '@/lib/ai/mini-ai-assets';

type PromptTemplateItem = Awaited<ReturnType<typeof listActivePromptTemplates>>['items'][number];

const PHOTO_WORDS = ['改造', '换风格', '重绘', '软装', '照片', '实景', '局部', '材质'];
const FLOOR_PLAN_WORDS = ['户型', '整屋', '空间', '客厅', '卧室', '餐厅', '厨房', '书房', '卫生间'];

function cleanName(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function inferSpace(name: string, categoryName: string) {
  const text = `${name} ${categoryName}`;
  const spaces = [
    ['客厅', 'living_room'], ['卧室', 'bedroom'], ['餐厅', 'dining_room'],
    ['厨房', 'kitchen'], ['书房', 'study'], ['卫生间', 'bathroom'],
    ['儿童房', 'kids_room'], ['阳台', 'balcony'],
  ] as const;
  const found = spaces.find(([label]) => text.includes(label));
  return found ? { key: found[1], label: found[0] } : { key: 'whole_home', label: '整屋' };
}

function inferInputTypes(template: PromptTemplateItem, categoryName: string) {
  const text = `${template.name} ${categoryName}`;
  const photoOnly = PHOTO_WORDS.some((word) => text.includes(word))
    && !FLOOR_PLAN_WORDS.some((word) => text.includes(word));
  return photoOnly ? ['photo'] : ['floor_plan', 'photo'];
}

function recipeDescription(name: string, categoryName: string, inputTypes: string[]) {
  const inputCopy = inputTypes.includes('floor_plan')
    ? '可套用完整户型或单个闭合房间'
    : '需要一张清晰的现场照片或已有成果';
  return `${categoryName || '空间方案'} · ${inputCopy}，生成${cleanName(name)}效果。`;
}

function decorateRecipe(input: {
  request: Request;
  enterpriseId: string;
  template: PromptTemplateItem;
  categoryName: string;
}) {
  const inputTypes = inferInputTypes(input.template, input.categoryName);
  const space = inferSpace(input.template.name, input.categoryName);
  return {
    id: input.template.id,
    name: cleanName(input.template.name),
    categoryId: input.template.categorySourceId,
    categoryName: input.categoryName || '精选配方',
    spaceKey: space.key,
    spaceLabel: space.label,
    inputTypes,
    supportsWholeFloorPlan: inputTypes.includes('floor_plan'),
    supportsSingleRoom: inputTypes.includes('floor_plan'),
    requiresPhoto: inputTypes.length === 1 && inputTypes[0] === 'photo',
    description: recipeDescription(input.template.name, input.categoryName, inputTypes),
    previewUrl: resolveMiniRecipePreviewUrl({
      request: input.request,
      recipeId: input.template.id,
      enterpriseId: input.enterpriseId,
      previewUrl: input.template.previewUrl,
      localPreviewUrl: input.template.localPreviewUrl,
    }),
    weight: input.template.weight,
  };
}

export async function listMiniAiRecipes(input: {
  request: Request;
  enterpriseId: string;
  page?: number;
  limit?: number;
  query?: string;
  categoryId?: string;
}) {
  const [categoryData, templateData] = await Promise.all([
    listActivePromptCategories(),
    listActivePromptTemplates({
      page: input.page,
      limit: input.limit,
      query: input.query,
      categorySourceId: input.categoryId,
    }),
  ]);
  const categoryById = new Map(categoryData.categories.map((item) => [item.sourceId, item.name]));
  return {
    revisionId: templateData.revisionId,
    categories: categoryData.categories.map((category) => ({
      id: category.sourceId,
      parentId: category.parentSourceId,
      name: category.name,
      level: category.level,
    })),
    items: templateData.items.map((template) => decorateRecipe({
      request: input.request,
      enterpriseId: input.enterpriseId,
      template,
      categoryName: categoryById.get(template.categorySourceId) || '',
    })),
    pagination: templateData.pagination,
  };
}

export async function getMiniAiRecipe(input: {
  request: Request;
  enterpriseId: string;
  recipeId: string;
}) {
  const [categoryData, template] = await Promise.all([
    listActivePromptCategories(),
    getActivePromptTemplate(input.recipeId),
  ]);
  if (!template) return null;
  const categoryName = categoryData.categories.find((item) => item.sourceId === template.categorySourceId)?.name || '';
  return {
    ...decorateRecipe({
      request: input.request,
      enterpriseId: input.enterpriseId,
      template,
      categoryName,
    }),
    internalPrompt: template.promptContent,
  };
}

export async function getMiniAiRecipeRuntime(recipeId: string) {
  const [categoryData, template] = await Promise.all([
    listActivePromptCategories(),
    getActivePromptTemplate(recipeId),
  ]);
  if (!template) return null;
  const categoryName = categoryData.categories.find((item) => item.sourceId === template.categorySourceId)?.name || '';
  return {
    id: template.id,
    name: cleanName(template.name),
    categorySourceId: template.categorySourceId,
    promptContent: template.promptContent,
    inputTypes: inferInputTypes(template, categoryName),
  };
}
