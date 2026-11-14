import { z } from 'zod';

/** Canonical I7.1 stage ids. The ten renovation stages never change order. */
export const stageIds = [
  'pre_construction', 'design', 'demolition', 'utilities', 'masonry',
  'painting', 'installation', 'furnishing', 'completion', 'occupancy',
] as const;
export type StageId = typeof stageIds[number];

/** The existing Construction stage keys stay authoritative for project facts.
 * Stage ids only name the lightweight agent, knowledge pack and report template. */
export const stageDefinitions = [
  { stageId: 'pre_construction', name: '前期', constructionKeys: ['preparation'] },
  { stageId: 'design', name: '设计', constructionKeys: ['design'] },
  { stageId: 'demolition', name: '拆改', constructionKeys: ['demolition'] },
  { stageId: 'utilities', name: '水电', constructionKeys: ['utilities'] },
  { stageId: 'masonry', name: '泥木', constructionKeys: ['masonry_carpentry'] },
  { stageId: 'painting', name: '油漆', constructionKeys: ['painting'] },
  { stageId: 'installation', name: '安装', constructionKeys: ['installation'] },
  { stageId: 'furnishing', name: '软装', constructionKeys: ['furnishing'] },
  { stageId: 'completion', name: '完工', constructionKeys: ['completion'] },
  { stageId: 'occupancy', name: '入住', constructionKeys: ['move_in'] },
] as const satisfies ReadonlyArray<{ stageId: StageId; name: string; constructionKeys: readonly string[] }>;
export type StageDefinition = typeof stageDefinitions[number];

const byStage = new Map<string, StageDefinition>(stageDefinitions.map(stage => [stage.stageId, stage]));
const byConstructionKey = new Map<string, StageDefinition>(
  stageDefinitions.flatMap(stage => stage.constructionKeys.map(key => [key, stage] as const)));

export function stageDefinition(stageId: string): StageDefinition | undefined {
  return byStage.get(stageId);
}

/** Unknown or custom enterprise stages must not be guessed into a stage agent. */
export function stageForConstructionKey(key: string | null | undefined): StageDefinition | undefined {
  return key ? byConstructionKey.get(key) : undefined;
}

export function stageIdForConstructionKey(key: string | null | undefined): StageId | null {
  return stageForConstructionKey(key)?.stageId ?? null;
}

export function constructionKeysForStage(stageId: StageId): readonly string[] {
  return stageDefinition(stageId)?.constructionKeys ?? [];
}

export const stageIdSchema = z.enum(stageIds);
