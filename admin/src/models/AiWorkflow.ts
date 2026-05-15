import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '@/lib/mongoose-tenant-plugin';
import type { AiWorkflowSourceAssetRole, AiWorkflowStageKey } from '@/lib/ai/workflow-stages';

export interface IAiWorkflow extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  operatorId: mongoose.Types.ObjectId;
  title: string;
  workflowLabel?: string;
  isPrimary: boolean;
  status: 'active' | 'archived';
  sourceImage?: string;
  sourceFloorPlanId?: mongoose.Types.ObjectId;
  sourceAssetRole: AiWorkflowSourceAssetRole;
  currentStageKey: AiWorkflowStageKey;
  selectedGenerationId?: mongoose.Types.ObjectId;
  lastGenerationId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiWorkflowSchema = new Schema<IAiWorkflow>(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
    },
    operatorId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    workflowLabel: {
      type: String,
      trim: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active',
    },
    sourceImage: {
      type: String,
    },
    sourceFloorPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'FloorPlan',
    },
    sourceAssetRole: {
      type: String,
      enum: ['rough_sketch', 'floor_plan', 'base_render', 'approved_render', 'concept_element'],
      default: 'rough_sketch',
    },
    currentStageKey: {
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
      default: 'direction',
    },
    selectedGenerationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiGeneration',
    },
    lastGenerationId: {
      type: Schema.Types.ObjectId,
      ref: 'AiGeneration',
    },
  },
  { timestamps: true }
);

AiWorkflowSchema.index({ enterpriseId: 1, updatedAt: -1 });
AiWorkflowSchema.index({ operatorId: 1, updatedAt: -1 });
AiWorkflowSchema.index({ leadId: 1, updatedAt: -1 });

AiWorkflowSchema.plugin(multiTenantPlugin);

export const AiWorkflow: Model<IAiWorkflow> =
  (mongoose.models.AiWorkflow as Model<IAiWorkflow> | undefined) ||
  mongoose.model<IAiWorkflow>('AiWorkflow', AiWorkflowSchema);
