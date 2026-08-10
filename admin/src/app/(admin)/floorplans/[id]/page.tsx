import { notFound } from 'next/navigation';
export const dynamic = "force-dynamic";
import { parsePostgresId } from '@/db/postgres-dto';
import { FloorPlanRepository, LeadRepository } from '@/db/repositories';
import FloorPlanViewerWrapper from '@/components/FloorPlanViewerWrapper';
import { getFloorPlanDisplay } from '@/lib/floor-plan-display';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getSessionUser } from '@/lib/session';

export default async function FloorPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let result;
  try {
    const session = await getSessionUser();
    if (!session) return notFound();
    result = await withAdminPostgresTransaction(
      {
        userId: session.id,
        username: session.username,
        role: session.role,
        enterpriseId: session.enterpriseId,
      },
      async (transaction) => {
        const plan = await new FloorPlanRepository(transaction).findById(
          parsePostgresId(id, 'floor plan id')
        );
        if (!plan) return null;
        const lead = await new LeadRepository(transaction).findByFloorPlanId(
          plan.id
        );
        return { plan, lead };
      }
    );

  } catch (error) {
    console.error(error);
    return notFound();
  }
  if (!result) return notFound();
  const { plan, lead } = result;
  const display = getFloorPlanDisplay(plan, {
    lead,
    measurementSequence: lead?.floorPlanRecords.find(
      (record) => record.id === plan.id
    )?.measurementSequence,
  });
  const serializedPlan = {
      _id: plan.id.toString(),
      name: display.projectTitle,
      display,
      layoutData: plan.layoutData,
      status: plan.status,
      source: plan.source,
      externalSource: plan.externalSource,
      createdAt: plan.createdAt.toISOString(),
      creator: plan.creator ? {
        _id: plan.creator.id.toString(),
        nickname: plan.creator.nickname,
        avatar: plan.creator.avatar,
        openid: plan.creator.openid,
        communityName: plan.creator.communityName,
        phone: plan.creator.phone,
      } : null,
      lead: lead ? {
        _id: lead.id.toString(),
        name: lead.name,
        status: lead.status,
        stylePreference: lead.stylePreference,
      } : null
  };

  return (
    <div className="min-h-screen bg-background">
      <FloorPlanViewerWrapper planData={serializedPlan} />
    </div>
  );
}
