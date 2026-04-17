import mongoose, { Schema, Document } from 'mongoose';

export interface IInspiration extends Document {
  title: string;
  coverImage: string;
  renderingImage: string;
  style: string;
  roomType: string;
  layoutData: any; // Stored as JSON for "one-click copy"
  isRecommended: boolean;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const InspirationSchema: Schema = new Schema({
  title: { type: String, required: true },
  coverImage: { type: String, required: true },
  renderingImage: { type: String, required: true },
  style: { type: String, required: true },
  roomType: { type: String, required: true },
  layoutData: { type: Schema.Types.Mixed, required: true },
  isRecommended: { type: Boolean, default: false },
  viewCount: { type: Number, default: 0 }
}, {
  timestamps: true
});

export default mongoose.models.Inspiration || mongoose.model<IInspiration>('Inspiration', InspirationSchema);
