export type CreationModelProfile = {
  id: string;
  key: string;
  name: string;
  description: string;
  sourceModelSourceIds: string[];
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
  sizes: string[];
  qualities: string[];
  defaults: { aspectRatio: string; size: string; quality: string };
};

export type CreationGeneration = {
  id: string;
  status: 'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  imageUrl?: string;
  error?: string;
  provider?: string;
  model?: string;
  workflowId?: string;
  createdAt: string;
};

export type CreationBatch = {
  id: string;
  sequence: number;
  prompt: string;
  negativePrompt?: string;
  modelProfileId: string;
  modelProfileSnapshot: CreationModelProfile;
  parameterSnapshot: { aspectRatio: string; size: string; quality: string; templateId?: string };
  requestedCount: number;
  status: 'pending' | 'processing' | 'succeeded' | 'partial' | 'failed';
  creditsEstimate: number;
  createdAt: string;
  generations: CreationGeneration[];
};

export type CreationTask = {
  id: string;
  title: string;
  prompt: string;
  referenceAssetIds: string[];
  modelProfileId: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  batches: CreationBatch[];
};

export type CreationAsset = {
  id: string;
  previewUrl: string;
  width?: number;
  height?: number;
};

export type PromptCategory = {
  id: string;
  sourceId: string;
  parentSourceId?: string;
  level: number;
  name: string;
  weight: number;
};

export type PromptTemplate = {
  id: string;
  name: string;
  promptContent: string;
  categorySourceId: string;
  bestModelSourceId?: string;
  recommendedModelProfileId?: string;
  previewUrl?: string;
  localPreviewUrl?: string;
};

export type CreationWorkflow = {
  id: string;
  title: string;
  leadName: string;
  communityName: string;
};
