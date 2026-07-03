import mongoose from 'mongoose';
import Lead from '@/models/Lead';

export async function linkFloorPlanToLead(leadId: unknown, floorPlanId: unknown) {
  const leadObjectId = String(leadId || '');
  const floorPlanObjectId = String(floorPlanId || '');

  if (
    !mongoose.Types.ObjectId.isValid(leadObjectId) ||
    !mongoose.Types.ObjectId.isValid(floorPlanObjectId)
  ) {
    return false;
  }

  const lead = await Lead.findById(leadObjectId);
  if (!lead) return false;

  const setUpdate: {
    primaryFloorPlanId: mongoose.Types.ObjectId;
    status?: 'measuring';
  } = {
    primaryFloorPlanId: new mongoose.Types.ObjectId(floorPlanObjectId),
  };

  if (lead.status === 'new') {
    setUpdate.status = 'measuring';
  }

  await Lead.findByIdAndUpdate(
    leadObjectId,
    {
      $addToSet: { floorPlanIds: new mongoose.Types.ObjectId(floorPlanObjectId) },
      $set: setUpdate,
    },
    { runValidators: true }
  );

  return true;
}
