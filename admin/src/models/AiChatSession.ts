import mongoose, { Document, Model, Schema } from 'mongoose';
import { multiTenantPlugin } from '../lib/mongoose-tenant-plugin';
import type { ChatUiPayload } from '@/lib/ai/chat-ui';

export interface IChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: Record<string, unknown>[];
  tool_outputs?: Record<string, unknown>[];
  uiPayload?: ChatUiPayload;
  createdAt: Date;
}

export interface IAiChatSession extends Document {
  enterpriseId: mongoose.Types.ObjectId;
  adminId: mongoose.Types.ObjectId;
  title: string;
  messages: IChatMessage[];
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiChatSessionSchema: Schema<IAiChatSession> = new Schema(
  {
    enterpriseId: {
      type: Schema.Types.ObjectId,
      ref: 'Enterprise',
      required: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: '新对话',
      trim: true,
    },
    messages: [
      {
        role: {
          type: String,
          enum: ['user', 'assistant', 'system'],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        tool_calls: [Schema.Types.Mixed],
        tool_outputs: [Schema.Types.Mixed],
        uiPayload: Schema.Types.Mixed,
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

AiChatSessionSchema.index({ adminId: 1, lastMessageAt: -1 });
AiChatSessionSchema.plugin(multiTenantPlugin);

const existingAiChatSessionModel = mongoose.models.AiChatSession as Model<IAiChatSession> | undefined;

if (existingAiChatSessionModel && !existingAiChatSessionModel.schema.path('messages.uiPayload')) {
  mongoose.deleteModel('AiChatSession');
}

export const AiChatSession: Model<IAiChatSession> =
  (mongoose.models.AiChatSession as Model<IAiChatSession> | undefined) ||
  mongoose.model<IAiChatSession>('AiChatSession', AiChatSessionSchema);
