import { notFound } from 'next/navigation';
import { floorPlanToDto, userToDto } from '@/db/postgres-dto';
import { FloorPlanRepository, UserRepository } from '@/db/repositories';
import { UserAuditDetail } from '@/components/user-audit/user-audit-detail';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function UserFloorPlansPage({
  params,
}: {
  params: Promise<{ openid: string }>;
}) {
  const { openid } = await params;
  const session = await getSessionUser();
  if (!session) return notFound();
  const result = await withAdminPostgresTransaction(
    {
      userId: session.id,
      username: session.username,
      role: session.role,
      enterpriseId: session.enterpriseId,
    },
    async (transaction) => {
      const user = await new UserRepository(transaction).findByOpenid(openid);
      if (!user) return null;
      const plans = await new FloorPlanRepository(transaction).list({
        creatorId: user.id,
        formalOnly: true,
        page: 1,
        limit: 100,
      });
      return {
        user: userToDto(user),
        plans: plans.rows.map(floorPlanToDto),
      };
    }
  );
  if (!result) return notFound();

  return <UserAuditDetail user={result.user} plans={result.plans} />;
}
