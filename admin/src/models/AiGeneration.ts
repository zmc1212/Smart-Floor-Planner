import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

export interface IAiGeneration extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  floorPlanId?: mongoose.Types.ObjectId;
  type: 'floor_plan_style' | 'furnishing_render' | 'soft_furnishing_render' | 'advice';
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
  };
  output: {
    imageUrl?: string;
    adviceText?: string;
    promptUsed?: string;
  };
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  provider: 'pollinations';
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
    floorPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'FloorPlan',
    },
    type: {
      type: String,
      enum: ['floor_plan_style', 'furnishing_render', 'soft_furnishing_render', 'advice'],
      required: true,
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
    },
    output: {
      imageUrl: { type: String },
      adviceText: { type: String },
      promptUsed: { type: String },
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed'],
      default: 'pending',
    },
    provider: {
      type: String,
      enum: ['pollinations'],
      default: 'pollinations',
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
    durationMs: { type: Number },
  },
  { timestamps: true }
);

AiGenerationSchema.index({ enterpriseId: 1, createdAt: -1 });
AiGenerationSchema.index({ operatorId: 1, createdAt: -1 });
AiGenerationSchema.index({ floorPlanId: 1 });

AiGenerationSchema.plugin(multiTenantPlugin);

const existingAiGenerationModel = mongoose.models.AiGeneration as Model<IAiGeneration> | undefined;
const existingTypePath = existingAiGenerationModel?.schema.path('type') as
  | { options?: { enum?: string[] } }
  | undefined;
const existingTypeEnum = existingTypePath?.options?.enum || [];

if (existingAiGenerationModel && !existingTypeEnum.includes('soft_furnishing_render')) {
  mongoose.deleteModel('AiGeneration');
}

export const AiGeneration: Model<IAiGeneration> =
  (mongoose.models.AiGeneration as Model<IAiGeneration> | undefined) ||
  mongoose.model<IAiGeneration>('AiGeneration', AiGenerationSchema);
