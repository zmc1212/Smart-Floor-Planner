export type CreationModelProfile = {
  id: string;
  key: string;
  name: string;
  description: string;
  sourceModelSourceIds: string[];
  sourceType: 'grs_catalog';
  adapterType: 'grs';
  remoteModel: string;
  family: 'gpt-image-2' | 'gpt-image-2-vip' | 'nano-banana' | 'nano-banana-2';
  catalogVersion: string;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
  aspectRatiosByResolutionTier: Partial<Record<'1K' | '2K' | '4K' | 'CUSTOM', string[]>>;
  sizes: string[];
  qualities: string[];
  resolutionTiers: Array<'1K' | '2K' | '4K' | 'CUSTOM'>;
  supportsCustomSize: boolean;
  defaults: {
    aspectRatio: string;
    size: string;
    quality: string;
    resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
  };
  isDefault: boolean;
  prices: Array<{
    id?: string;
    modelProfileKey: string;
    resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
    credits: number;
    enabled: boolean;
  }>;
};

export type CreationGeneration = {
  id: string;
  status: 'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  imageUrl?: string;
  // When loading a workflow detail, the backend may attach whether this generation
  // has already been published (confirmed) to the customer under the workflow.
  published?: boolean;
  error?: string;
  provider?: string;
  model?: string;
  workflowId?: string;
  retryCount: number;
  createdAt: string;
};

export type CreationBatch = {
  id: string;
  sequence: number;
  prompt: string;
  negativePrompt?: string;
  referenceAssetIds: string[];
  modelProfileId: string;
  modelProfileSnapshot: CreationModelProfile;
  parameterSnapshot: {
    aspectRatio: string;
    resolutionTier?: '1K' | '2K' | '4K' | 'CUSTOM';
    width?: number;
    height?: number;
    size?: string;
    quality?: string;
    templateId?: string;
    renderMode?: 'whole_floor_plan' | 'single_room_photo' | 'soft_furnishing';
    hasStyleReference?: boolean;
    hasSitePhoto?: boolean;
    styleReferenceAssetId?: string;
    sitePhotoAssetIds?: string[];
    floorPlanControlAssetId?: string;
    targetScope?: 'whole_floor_plan' | 'single_room';
    targetLabel?: string;
    roomId?: string;
  };
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
  role?: 'style_reference' | 'site_photo' | 'additional_reference';
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
