'use client';

import { useParams, usePathname } from 'next/navigation';
import { useFetch } from '@/hooks/useFetch';
import EnterprisePageHeader from '@/components/enterprise/EnterprisePageHeader';
import { EnterpriseListItem } from '@/components/enterprise/types';
import EnterpriseAiCreditsManager from '@/components/enterprise/EnterpriseAiCreditsManager';

export default function EnterpriseAiPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading } = useFetch<EnterpriseListItem>(enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null);
  if (isLoading || !enterprise) return <div className="min-h-screen bg-muted/20 px-6 py-12"><div className="mx-auto max-w-7xl border bg-background p-10 text-sm text-muted-foreground">正在加载企业 AI 管理页...</div></div>;
  return <div className="min-h-screen bg-muted/20 px-6 py-10"><div className="mx-auto max-w-7xl space-y-8">
    <EnterprisePageHeader enterprise={enterprise} currentPath={pathname} />
    <section className="border-b pb-5"><h1 className="text-xl font-semibold">企业 AI 管理</h1><p className="mt-2 text-sm text-muted-foreground">管理企业共享 AI 点数、任务流水和实际供应商路由。供应商凭证由平台统一维护。</p></section>
    <EnterpriseAiCreditsManager enterpriseId={enterpriseId} />
  </div></div>;
}
