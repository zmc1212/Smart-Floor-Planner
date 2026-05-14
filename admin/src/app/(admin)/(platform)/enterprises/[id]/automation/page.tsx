'use client';

import { useParams, usePathname } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFetch } from '@/hooks/useFetch';
import EnterpriseAutomationManager from '@/components/enterprise/EnterpriseAutomationManager';
import EnterprisePageHeader from '@/components/enterprise/EnterprisePageHeader';
import { EnterpriseListItem } from '@/components/enterprise/types';

export default function EnterpriseAutomationPage() {
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
          正在加载企业自动化配置...
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
            <CardTitle>企业自动化配置</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-2 text-sm text-muted-foreground">
            集中维护协作 SLA、超时催办频率，以及浏览器通知和微信小程序通知开关。
          </CardContent>
        </Card>

        <EnterpriseAutomationManager
          enterprise={enterprise}
          onRefresh={async () => {
            await mutate();
          }}
        />
      </div>
    </div>
  );
}
