import mongoose, { Schema, Document, Model } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';

/**
 * AI 生成记录 — 追踪每一次 AI 生成的参数、结果和消耗
 */
export interface IAiGeneration extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId; // AdminUser who triggered
  /** 关联的户型图 */
  floorPlanId?: mongoose.Types.ObjectId;
  /** 生成类型 */
  type: 'floor_plan_style' | 'furnishing_render' | 'advice';
  /** 输入参数 */
  input: {
    style: string;
    roomType?: string;
    roomName?: string;
    width?: number;
    height?: number;
    mode?: string;
    customPrompt?: string;
  };
  /** AI 生成的结果 */
  output: {
    imageUrl?: string;
    adviceText?: string;
    promptUsed?: string;
  };
  /** 状态 */
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  /** 服务提供商 */
  provider: 'replicate' | 'tensor';
  /** 外部任务 ID (Replicate Prediction ID 或 Tensor Job ID) */
  externalJobId?: string;
  /** Replicate 任务 ID (遗留字段) */
  replicatePredictionId?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** 生成耗时 (ms) */
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
      enum: ['floor_plan_style', 'furnishing_render', 'advice'],
      required: true,
    },
    input: {
      style: { type: String, required: true },
      roomType: { type: String },
      roomName: { type: String },
      width: { type: Number },
      height: { type: Number },
      mode: { type: String },
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
      enum: ['replicate', 'tensor'],
      default: 'replicate',
    },
    externalJobId: { type: String },
    replicatePredictionId: { type: String },
    errorMessage: { type: String },
    durationMs: { type: Number },
  },
  { timestamps: true }
);

AiGenerationSchema.index({ enterpriseId: 1, createdAt: -1 });
AiGenerationSchema.index({ operatorId: 1, createdAt: -1 });
AiGenerationSchema.index({ floorPlanId: 1 });

AiGenerationSchema.plugin(multiTenantPlugin);

export const AiGeneration: Model<IAiGeneration> =
  mongoose.models.AiGeneration || mongoose.model<IAiGeneration>('AiGeneration', AiGenerationSchema);
