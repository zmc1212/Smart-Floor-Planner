'use client';

import { useParams, usePathname } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EnterprisePageHeader from '@/components/enterprise/EnterprisePageHeader';
import EnterpriseWecomManager from '@/components/enterprise/EnterpriseWecomManager';
import { EnterpriseListItem } from '@/components/enterprise/types';
import { useFetch } from '@/hooks/useFetch';

export default function EnterpriseWecomPage() {
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
          正在加载企业微信管理页...
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
            <CardTitle>企业微信管理</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-2 text-sm text-muted-foreground">
            这里维护企业微信应用配置与企微催办开关，员工个人接收 ID 仍在员工管理中维护。
          </CardContent>
        </Card>

        <EnterpriseWecomManager
          enterprise={enterprise}
          onSaved={async () => {
            await mutate();
          }}
        />
      </div>
    </div>
  );
}
