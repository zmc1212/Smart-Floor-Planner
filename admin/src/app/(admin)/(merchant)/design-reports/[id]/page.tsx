import { ReportEditor } from '@/components/design-reports/report-workspace';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ReportEditor id={(await params).id} />;
}
