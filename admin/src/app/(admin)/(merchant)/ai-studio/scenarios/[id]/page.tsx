import { redirect } from 'next/navigation';

export default async function ScenarioDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const existing = await searchParams;
  const query = new URLSearchParams();
  Object.entries(existing).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.set(key, value);
  });
  query.set('workflowId', id);
  redirect(`/ai-studio/scenarios?${query.toString()}`);
}
