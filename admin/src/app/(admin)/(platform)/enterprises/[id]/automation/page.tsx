'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Skeleton, Space, Tag, Typography } from 'antd';
import { useFetch } from '@/hooks/useFetch';
import EnterpriseAutomationManager from '@/components/enterprise/EnterpriseAutomationManager';
import { EnterpriseListItem } from '@/components/enterprise/types';

const ENTERPRISE_TABS = [
  { suffix: '', label: '企业概览' },
  { suffix: '/ai', label: 'AI 管理' },
  { suffix: '/automation', label: '自动化配置' },
];

export default function EnterpriseAutomationPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading, mutate } = useFetch<EnterpriseListItem>(enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null);

  if (isLoading || !enterprise) {
    return <div className="admin-page-frame"><PageContainer breadcrumbRender={false} className="admin-page-container" title="企业自动化配置"><Card className="admin-panel-card"><Skeleton active paragraph={{ rows: 5 }} /></Card></PageContainer></div>;
  }

  const tabs = ENTERPRISE_TABS.map((item) => ({ key: `/enterprises/${enterprise._id}${item.suffix}`, tab: item.label }));

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="企业自动化配置"
        content={<Space size={12} wrap><Tag color={enterprise.status === 'active' ? 'success' : 'warning'}>{enterprise.name}</Tag><Typography.Text type="secondary">集中维护协作 SLA、超时催办频率，以及通知开关。</Typography.Text></Space>}
        onBack={() => router.push(`/enterprises/${enterprise._id}`)}
        tabList={tabs}
        tabActiveKey={pathname}
        onTabChange={(key) => router.push(key)}
      >
        <EnterpriseAutomationManager enterprise={enterprise} onRefresh={async () => { await mutate(); }} />
      </PageContainer>
    </div>
  );
}
