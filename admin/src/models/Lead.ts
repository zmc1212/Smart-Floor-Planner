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
  status: 'new' | 'contacted' | 'measuring' | 'designing' | 'quoting' | 'converted' | 'closed';
  notes?: string;
  enterpriseId?: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId; // Designer/Consultant (AdminUser)
  assignedAt?: Date;
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
  status: { type: String, enum: ['new', 'contacted', 'measuring', 'designing', 'quoting', 'converted', 'closed'], default: 'new' },
  notes: { type: String },
  enterpriseId: { type: Schema.Types.ObjectId, ref: 'Enterprise' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  assignedAt: { type: Date },
  followUpRecords: [{
    content: { type: String, required: true },
    operator: { type: String, default: 'System' },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

export default mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema);
