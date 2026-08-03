'use client';

import { Suspense } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Loader2 } from 'lucide-react';
import MerchantDashboard from '@/components/MerchantDashboard';
import PlatformDashboard from '@/components/PlatformDashboard';

type AdminHomeDashboardProps = {
  displayName: string;
  username: string;
  role: string;
  enterpriseName: string | null;
};

export default function AdminHomeDashboard({
  displayName,
  username,
  role,
  enterpriseName,
}: AdminHomeDashboardProps) {
  const isPlatformAdmin = role === 'super_admin' || role === 'admin';
  const title = isPlatformAdmin ? '平台管理中心' : '企业工作台';
  const content = isPlatformAdmin
    ? '全局业务数据概览'
    : `欢迎回来，${displayName}。这里是 ${enterpriseName || '个人'} 工作台。`;

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={title}
        content={content}
      >
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-primary" size={40} /></div>}>
          {isPlatformAdmin ? (
            <PlatformDashboard />
          ) : (
            <MerchantDashboard
              admin={{ displayName, username, role, enterpriseName }}
            />
          )}
        </Suspense>
      </PageContainer>
    </div>
  );
}
