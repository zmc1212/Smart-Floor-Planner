import mongoose, { Schema, Document } from 'mongoose';

export interface ILead extends Document {
  name: string;
  phone: string;
  area?: number;
  stylePreference?: string;
  city?: string;
  source: string; // e.g., 'ai-gen', 'index-banner'
  status: 'new' | 'contacted' | 'converted' | 'closed';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema: Schema = new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  area: { type: Number },
  stylePreference: { type: String },
  city: { type: String },
  source: { type: String, default: 'unknown' },
  status: { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new' },
  notes: { type: String }
}, {
  timestamps: true
});

export default mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);
