import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';
import type { AiActionKey, AiCapability, AiLogicalModelKey, AiProviderAttemptStatus } from '@/lib/ai/provider-types';

export interface IAiGeneration extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  floorPlanId?: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId;
  workflowId?: mongoose.Types.ObjectId;
  parentGenerationId?: mongoose.Types.ObjectId;
  type: 'floor_plan_style' | 'furnishing_render' | 'soft_furnishing_render' | 'advice' | 'scenario' | 'reference_recreate' | 'style_transform';
  channel?: 'admin' | 'miniprogram';
  stageKey?: AiWorkflowStageKey;
  sourceAssetRole?: AiWorkflowSourceAssetRole;
  isSelectedBaseline?: boolean;
  nextRecommendedStage?: AiWorkflowStageKey;
  input: {
    style: string;
    roomType?: string;
    roomName?: string;
    width?: number;
    height?: number;
    mode?: string;
    roomData?: unknown;
    presetSnapshot?: unknown;
    sourceImage?: string;
    furnitureItems?: unknown;
    sceneAnalysis?: unknown;
    placementPlan?: unknown;
    placementGuideImage?: string;
    customPrompt?: string;
    styleReferenceImage?: string;
    spaceImage?: string;
    referenceImage?: string;
    controlImage?: string;
    referenceAnalysis?: string;
    providerImages?: string[];
    providerRequest?: unknown;
  };
  output: {
    imageUrl?: string;
    adviceText?: string;
    promptUsed?: string;
  };
  status: 'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  provider?: string;
  capability?: AiCapability;
  logicalModelKey?: AiLogicalModelKey;
  actionKey?: AiActionKey;
  currentAttemptId?: mongoose.Types.ObjectId;
  externalTask?: {
    status?: AiProviderAttemptStatus;
    remoteTaskId?: string;
    remoteStatus?: string;
    nextPollAt?: Date;
    lastPolledAt?: Date;
  };
  apiKeyId?: string;
  apiKeyName?: string;
  remoteCostUsd?: number;
  remoteModel?: string;
  remoteMeterSource?: string;
  quotaSnapshot?: {
    balance?: number;
    keyStatus?: string;
    allowedModels?: string[];
    lastSyncedAt?: Date;
  };
  errorMessage?: string;
  errorCode?: string;
  retryCount?: number;
  billing?: {
    cycle?: number;
    actionKey?: AiActionKey;
    price?: number;
    priceSnapshot?: { actionKey: string; label: string; credits: number; capturedAt: Date };
    status?: 'unbilled' | 'held' | 'consumed' | 'released';
    holdOperationId?: string;
    consumeOperationId?: string;
    releaseOperationId?: string;
  };
  deletedAt?: Date;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

const AiGenerationSchema: Schema<IAiGeneration> = new Schema(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'AiWorkflow',
    },
    parentGenerationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiGeneration',
    },
    floorPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'FloorPlan',
    },
    type: {
      type: String,
      enum: ['floor_plan_style', 'furnishing_render', 'soft_furnishing_render', 'advice', 'scenario', 'reference_recreate', 'style_transform'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['admin', 'miniprogram'],
      default: 'admin',
      index: true,
    },
    stageKey: {
      type: String,
      enum: [
        'direction',
        'base_render',
        'soft_furnishing',
        'proposal_pack',
        'lighting',
        'tour_board',
        'premium_board',
        'perspective_upgrade',
        'cad_detail',
      ],
    },
    sourceAssetRole: {
      type: String,
      enum: ['rough_sketch', 'floor_plan', 'base_render', 'approved_render', 'concept_element'],
    },
    isSelectedBaseline: {
      type: Boolean,
      default: false,
    },
    nextRecommendedStage: {
      type: String,
      enum: ['direction', 'base_render', 'soft_furnishing', 'proposal_pack', 'lighting'],
    },
    input: {
      style: { type: String, required: true },
      roomType: { type: String },
      roomName: { type: String },
      width: { type: Number },
      height: { type: Number },
      mode: { type: String },
      roomData: { type: Schema.Types.Mixed },
      presetSnapshot: { type: Schema.Types.Mixed },
      sourceImage: { type: String },
      furnitureItems: { type: Schema.Types.Mixed },
      sceneAnalysis: { type: Schema.Types.Mixed },
      placementPlan: { type: Schema.Types.Mixed },
      placementGuideImage: { type: String },
      customPrompt: { type: String },
      styleReferenceImage: { type: String },
      spaceImage: { type: String },
      referenceImage: { type: String },
      controlImage: { type: String },
      referenceAnalysis: { type: String },
      providerImages: { type: [String], default: undefined },
      providerRequest: { type: Schema.Types.Mixed },
    },
    output: {
      imageUrl: { type: String },
      adviceText: { type: String },
      promptUsed: { type: String },
    },
    status: {
      type: String,
      enum: ['created', 'pending', 'processing', 'succeeded', 'failed', 'cancelled'],
      default: 'pending',
    },
    provider: {
      type: String,
      default: undefined,
    },
    capability: { type: String, enum: ['chat', 'vision', 'image.generate', 'image.edit'] },
    logicalModelKey: { type: String },
    actionKey: { type: String },
    currentAttemptId: { type: Schema.Types.ObjectId, ref: 'AiProviderAttempt' },
    externalTask: {
      status: { type: String, enum: ['created', 'submitted', 'processing', 'succeeded', 'failed', 'unknown'] },
      remoteTaskId: String,
      remoteStatus: String,
      nextPollAt: Date,
      lastPolledAt: Date,
    },
    apiKeyId: { type: String },
    apiKeyName: { type: String },
    remoteCostUsd: { type: Number },
    remoteModel: { type: String },
    remoteMeterSource: { type: String },
    quotaSnapshot: {
      balance: { type: Number },
      keyStatus: { type: String },
      allowedModels: { type: [String], default: [] },
      lastSyncedAt: { type: Date },
    },
    errorMessage: { type: String },
    errorCode: { type: String },
    retryCount: { type: Number, default: 0, min: 0 },
    billing: {
      cycle: { type: Number, default: 0, min: 0 },
      actionKey: String,
      price: { type: Number, min: 0 },
      priceSnapshot: {
        actionKey: String,
        label: String,
        credits: Number,
        capturedAt: Date,
      },
      status: {
        type: String,
        enum: ['unbilled', 'held', 'consumed', 'released'],
        default: 'unbilled',
      },
      holdOperationId: { type: String },
      consumeOperationId: { type: String },
      releaseOperationId: { type: String },
    },
    deletedAt: { type: Date, index: true },
    durationMs: { type: Number },
  },
  { timestamps: true }
);

AiGenerationSchema.index({ enterpriseId: 1, createdAt: -1 });
AiGenerationSchema.index({ operatorId: 1, createdAt: -1 });
AiGenerationSchema.index({ floorPlanId: 1 });
AiGenerationSchema.index({ leadId: 1, createdAt: -1 });
AiGenerationSchema.index({ workflowId: 1, createdAt: -1 });
AiGenerationSchema.index({ leadId: 1, workflowId: 1, createdAt: -1 });
AiGenerationSchema.index({ workflowId: 1, stageKey: 1, createdAt: -1 });
AiGenerationSchema.index({ enterpriseId: 1, channel: 1, deletedAt: 1, createdAt: -1 });
AiGenerationSchema.index({ status: 1, 'externalTask.nextPollAt': 1 });

AiGenerationSchema.plugin(multiTenantPlugin);

const existingAiGenerationModel = mongoose.models.AiGeneration as Model<IAiGeneration> | undefined;
const existingTypePath = existingAiGenerationModel?.schema.path('type') as
  | { options?: { enum?: string[] } }
  | undefined;
const existingTypeEnum = existingTypePath?.options?.enum || [];
const existingProviderPath = existingAiGenerationModel?.schema.path('provider') as
  | { options?: { enum?: string[] } }
  | undefined;

if (
  existingAiGenerationModel &&
  (!existingTypeEnum.includes('soft_furnishing_render') ||
    !existingTypeEnum.includes('scenario') ||
    !existingTypeEnum.includes('reference_recreate') ||
    Boolean(existingProviderPath?.options?.enum?.length))
) {
  mongoose.deleteModel('AiGeneration');
}

export const AiGeneration: Model<IAiGeneration> =
  (mongoose.models.AiGeneration as Model<IAiGeneration> | undefined) ||
  mongoose.model<IAiGeneration>('AiGeneration', AiGenerationSchema);
