export type SourceRecord = Record<string, unknown>;

export type PromptLibrarySnapshot = {
  categories: SourceRecord[];
  templates: SourceRecord[];
  parameterTemplates: SourceRecord[];
  models: SourceRecord[];
};

export type PromptLibraryCounts = {
  categories: number;
  templates: number;
  parameterTemplates: number;
  models: number;
  previewAssets: number;
};

export type StagedPromptAsset = {
  templateSourceId: string;
  sourceUrl: string;
  filePath: string;
  mimeType: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  checksumSha256: string;
};

export type NormalizedPromptCategory = {
  sourceId: string;
  parentSourceId?: string;
  level: number;
  name: string;
  weight: number;
  enabled: boolean;
  sourcePayload: SourceRecord;
  sourceHash: string;
};

export type NormalizedPromptParameterTemplate = {
  sourceId: string;
  name: string;
  adaptationModel: string[];
  parameters: SourceRecord;
  weight: number;
  enabled: boolean;
  sourcePayload: SourceRecord;
  sourceHash: string;
};

export type NormalizedPromptSourceModel = {
  sourceId: string;
  name: string;
  modelCode?: string;
  capabilities: SourceRecord;
  weight: number;
  enabled: boolean;
  sourcePayload: SourceRecord;
  sourceHash: string;
};

export type NormalizedPromptTemplate = {
  sourceId: string;
  name: string;
  promptContent: string;
  categorySourceId: string;
  bestModelSourceId?: string;
  parameterTemplateSourceId?: string;
  adaptationModel: string[];
  previewSourceUrl?: string;
  weight: number;
  enabled: boolean;
  sourcePayload: SourceRecord;
  sourceHash: string;
};

export type NormalizedPromptLibrary = {
  categories: NormalizedPromptCategory[];
  templates: NormalizedPromptTemplate[];
  parameterTemplates: NormalizedPromptParameterTemplate[];
  models: NormalizedPromptSourceModel[];
  skippedTemplates: Array<{
    sourceId: string;
    bestModelSourceId: string;
    reason: 'missing_recommended_model';
    sourceHash: string;
  }>;
};

export type PromptLibraryValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: PromptLibraryCounts;
};
