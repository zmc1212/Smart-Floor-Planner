import { ReportList } from '@/components/design-reports/report-workspace';
export default async function Page({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const { leadId } = await searchParams;
  return <ReportList leadId={leadId} />;
}
