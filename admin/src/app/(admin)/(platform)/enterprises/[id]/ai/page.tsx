'use client';

import { useParams, usePathname } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFetch } from '@/hooks/useFetch';
import EnterpriseAiManager from '@/components/enterprise/EnterpriseAiManager';
import EnterprisePageHeader from '@/components/enterprise/EnterprisePageHeader';
import { EnterpriseListItem } from '@/components/enterprise/types';

export default function EnterpriseAiPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading, mutate } = useFetch<EnterpriseListItem>(
    enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null
  );

  if (isLoading || !enterprise) {
    return (
      <div className="min-h-screen bg-[#f7f7f5] px-6 py-12">
        <div className="mx-auto max-w-7xl rounded-3xl border bg-white p-10 text-sm text-muted-foreground shadow-sm">
          正在加载企业 AI 管理页...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <EnterprisePageHeader enterprise={enterprise} currentPath={pathname} />

        <Card className="rounded-3xl border-muted shadow-sm">
          <CardHeader className="p-6 pb-2">
            <CardTitle>企业 AI 管理</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-2 text-sm text-muted-foreground">
            这里集中处理企业 Pollinations 子 Key、预算、模型白名单与官方余额同步。
          </CardContent>
        </Card>

        <EnterpriseAiManager
          enterprise={enterprise}
          onRefresh={async () => {
            await mutate();
          }}
        />
      </div>
    </div>
  );
}
