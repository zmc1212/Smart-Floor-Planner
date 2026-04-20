import { notFound } from 'next/navigation';
export const dynamic = "force-dynamic";
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { User } from '@/models/User';
import FloorPlanViewer from '@/components/FloorPlanViewer';

export default async function FloorPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await dbConnect();

  const { id } = await params;

  try {
    const plan = await FloorPlan.findById(id).populate({
      path: 'creator',
      model: User,
      select: 'nickname avatar openid communityName'
    }).lean();

    if (!plan) {
      return notFound();
    }

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
      } : null
    };

    return (
      <div className="bg-white min-h-screen">
        <FloorPlanViewer planData={serializedPlan} />
      </div>
    );
  } catch (error) {
    console.error(error);
    return notFound();
  }
}
