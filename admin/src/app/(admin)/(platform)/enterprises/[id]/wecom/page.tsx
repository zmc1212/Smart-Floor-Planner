import { redirect } from 'next/navigation';

export default async function EnterpriseWecomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/enterprises/${id}`);
}
