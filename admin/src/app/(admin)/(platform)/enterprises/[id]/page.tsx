'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Settings2, Shield, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import EnterpriseOverviewCards from '@/components/enterprise/EnterpriseOverviewCards';
import EnterprisePageHeader from '@/components/enterprise/EnterprisePageHeader';
import { EnterpriseListItem } from '@/components/enterprise/types';
import { useState } from 'react';

export default function EnterpriseDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading, mutate } = useFetch<EnterpriseListItem>(
    enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null
  );
  const [showEditor, setShowEditor] = useState(false);

  if (isLoading || !enterprise) {
    return (
      <div className="min-h-screen bg-[#f7f7f5] px-6 py-12">
        <div className="mx-auto max-w-7xl rounded-3xl border bg-white p-10 text-sm text-muted-foreground shadow-sm">
          正在加载企业概览...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] px-6 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <EnterprisePageHeader enterprise={enterprise} currentPath={pathname} />

        <EnterpriseOverviewCards enterprise={enterprise} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <Card className="rounded-3xl border-muted shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
              <CardTitle>基础信息</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowEditor(true)}>
                编辑基础信息
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 p-6 pt-2 text-sm text-muted-foreground md:grid-cols-2">
              <div className="rounded-2xl bg-muted/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.12em]">企业名称</div>
                <div className="mt-2 text-base font-semibold text-foreground">{enterprise.name}</div>
              </div>
              <div className="rounded-2xl bg-muted/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.12em]">企业编码</div>
                <div className="mt-2 text-base font-semibold text-foreground">{enterprise.code}</div>
              </div>
              <div className="rounded-2xl bg-muted/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.12em]">联系人</div>
                <div className="mt-2 text-base font-semibold text-foreground">{enterprise.contactPerson?.name || '-'}</div>
                <div className="mt-1">{enterprise.contactPerson?.phone || '-'}</div>
                <div>{enterprise.contactPerson?.email || '未填写邮箱'}</div>
              </div>
              <div className="rounded-2xl bg-muted/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.12em]">品牌信息</div>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="h-8 w-8 rounded-lg border"
                    style={{ backgroundColor: enterprise.branding?.primaryColor || '#171717' }}
                  />
                  <span className="font-medium text-foreground">
                    主色 {enterprise.branding?.primaryColor || '#171717'}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="h-8 w-8 rounded-lg border"
                    style={{ backgroundColor: enterprise.branding?.accentColor || '#0070f3' }}
                  />
                  <span className="font-medium text-foreground">
                    强调色 {enterprise.branding?.accentColor || '#0070f3'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-muted shadow-sm">
            <CardHeader className="p-6 pb-2">
              <CardTitle>专项管理入口</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6 pt-2">
              <Link
                href={`/enterprises/${enterprise._id}/ai`}
                className="flex items-center justify-between rounded-2xl border bg-white px-4 py-4 transition-colors hover:bg-muted/30"
              >
                <div>
                  <div className="font-semibold text-foreground">AI 管理</div>
                  <div className="text-sm text-muted-foreground">查看企业子 Key、余额、用量和模型权限。</div>
                </div>
                <Sparkles className="text-emerald-600" size={18} />
              </Link>
              <Link
                href={`/enterprises/${enterprise._id}/wecom`}
                className="flex items-center justify-between rounded-2xl border bg-white px-4 py-4 transition-colors hover:bg-muted/30"
              >
                <div>
                  <div className="font-semibold text-foreground">企业微信管理</div>
                  <div className="text-sm text-muted-foreground">维护企业微信应用配置与员工接收完成度。</div>
                </div>
                <Shield className="text-blue-600" size={18} />
              </Link>
              <div className="flex items-center justify-between rounded-2xl border border-dashed bg-white px-4 py-4">
                <div>
                  <div className="font-semibold text-foreground">自动化配置</div>
                  <div className="text-sm text-muted-foreground">当前保留在基础信息编辑中，后续可独立成页。</div>
                </div>
                <Settings2 className="text-amber-600" size={18} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <EnterpriseEditorDialog
        open={showEditor}
        onOpenChange={setShowEditor}
        enterprise={enterprise}
        onSaved={async () => {
          await mutate();
        }}
      />
    </div>
  );
}
