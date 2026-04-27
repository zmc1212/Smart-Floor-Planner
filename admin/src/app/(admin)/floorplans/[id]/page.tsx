import { notFound } from 'next/navigation';
export const dynamic = "force-dynamic";
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import Lead from '@/models/Lead';
import FloorPlanViewerWrapper from '@/components/FloorPlanViewerWrapper';

export default async function FloorPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await dbConnect();

  const { id } = await params;

  try {
    const plan = await FloorPlan.findById(id).populate({
      path: 'creator',
      model: User,
      select: 'nickname avatar openid communityName phone'
    }).lean();

    if (!plan) {
      return notFound();
    }

    // Find associated lead
    const lead = await Lead.findOne({ floorPlanIds: plan._id }).lean();

    // Serialize properly for the client component
    const serializedPlan = {
      _id: plan._id.toString(),
      name: plan.name,
      layoutData: plan.layoutData,
      status: plan.status,
      createdAt: plan.createdAt?.toISOString(),
      creator: plan.creator ? {
        _id: (plan.creator as any)._id.toString(),
        nickname: (plan.creator as any).nickname,
        avatar: (plan.creator as any).avatar,
        openid: (plan.creator as any).openid,
        communityName: (plan.creator as any).communityName,
        phone: (plan.creator as any).phone,
      } : null,
      lead: lead ? {
        _id: (lead as any)._id.toString(),
        name: lead.name,
        status: lead.status,
        stylePreference: lead.stylePreference,
        wecomGroupId: lead.wecomGroupId,
      } : null
    };

    return (
      <div className="bg-white min-h-screen">
        <FloorPlanViewerWrapper planData={serializedPlan} />
      </div>
    );
  } catch (error) {
    console.error(error);
    return notFound();
  }
}
