import { redirect } from 'next/navigation';
import AdminHomeDashboard from '@/components/dashboard/AdminHomeDashboard';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <AdminHomeDashboard
      displayName={user.displayName}
      username={user.username}
      role={user.role}
      enterpriseName={user.enterpriseName}
    />
  );
}
