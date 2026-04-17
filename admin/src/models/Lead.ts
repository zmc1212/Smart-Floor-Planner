import mongoose, { Schema, Document } from 'mongoose';

export interface IFollowUp {
  content: string;
  operator: string;
  createdAt: Date;
}

export interface ILead extends Document {
  name: string;
  phone: string;
  area?: number;
  stylePreference?: string;
  city?: string;
  source: string; 
  status: 'new' | 'contacted' | 'converted' | 'closed';
  notes?: string;
  assignedTo?: string; // Designer/Consultant name or ID
  followUpRecords: IFollowUp[];
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
  notes: { type: String },
  assignedTo: { type: String },
  followUpRecords: [{
    content: { type: String, required: true },
    operator: { type: String, default: 'System' },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

export default mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);
