'use client';

import { useParams, usePathname, useRouter } from 'next/navigation';
import { PageContainer, ProDescriptions } from '@ant-design/pro-components';
import { Button, Card, Col, Flex, Row, Skeleton, Space, Tag, Typography } from 'antd';
import { Settings2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useFetch } from '@/hooks/useFetch';
import EnterpriseEditorDialog from '@/components/enterprise/EnterpriseEditorDialog';
import EnterpriseOverviewCards from '@/components/enterprise/EnterpriseOverviewCards';
import { EnterpriseListItem } from '@/components/enterprise/types';

const ENTERPRISE_TABS = [
  { suffix: '', label: '企业概览' },
  { suffix: '/ai', label: 'AI 管理' },
  { suffix: '/automation', label: '自动化配置' },
];

function EnterpriseStatus({ status }: { status: EnterpriseListItem['status'] }) {
  if (status === 'active') return <Tag color="success">正常</Tag>;
  if (status === 'pending_approval') return <Tag color="warning">待审核</Tag>;
  return <Tag>已停用</Tag>;
}

export default function EnterpriseDetailPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const enterpriseId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const { data: enterprise, isLoading, mutate } = useFetch<EnterpriseListItem>(
    enterpriseId ? `/api/admin/enterprises/${enterpriseId}` : null,
  );
  const [showEditor, setShowEditor] = useState(false);

  if (isLoading || !enterprise) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="企业概览">
          <Card className="admin-panel-card"><Skeleton active paragraph={{ rows: 5 }} /></Card>
        </PageContainer>
      </div>
    );
  }

  const tabs = ENTERPRISE_TABS.map((item) => ({
    key: `/enterprises/${enterprise._id}${item.suffix}`,
    tab: item.label,
  }));

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={enterprise.name}
        content={(
          <Space size={12} wrap>
            <EnterpriseStatus status={enterprise.status} />
            <Typography.Text type="secondary">企业编码：{enterprise.code}</Typography.Text>
            <Typography.Text type="secondary">联系人：{enterprise.contactPerson?.name || '-'}</Typography.Text>
            <Typography.Text type="secondary">创建时间：{enterprise.createdAt ? new Date(enterprise.createdAt).toLocaleString() : '-'}</Typography.Text>
          </Space>
        )}
        onBack={() => router.push('/enterprises')}
        tabList={tabs}
        tabActiveKey={pathname}
        onTabChange={(key) => router.push(key)}
        extra={[
          <Button key="edit" onClick={() => setShowEditor(true)}>编辑基础信息</Button>,
          <Button key="ai" type="primary" icon={<Sparkles size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/ai`)}>AI 管理</Button>,
        ]}
      >
        <Flex vertical gap={24}>
          <EnterpriseOverviewCards enterprise={enterprise} />

          <Row gutter={[24, 24]}>
            <Col xs={24} lg={14}>
              <Card title="基础信息" className="admin-panel-card">
                <ProDescriptions<EnterpriseListItem>
                  column={{ xs: 1, sm: 2 }}
                  dataSource={enterprise}
                  columns={[
                    { title: '企业名称', dataIndex: 'name' },
                    { title: '企业编码', dataIndex: 'code', copyable: true },
                    { title: '联系人', dataIndex: ['contactPerson', 'name'], render: (_, item) => item.contactPerson?.name || '-' },
                    { title: '联系电话', dataIndex: ['contactPerson', 'phone'], render: (_, item) => item.contactPerson?.phone || '-' },
                    { title: '联系邮箱', dataIndex: ['contactPerson', 'email'], render: (_, item) => item.contactPerson?.email || '-' },
                    { title: '地推固定提成', dataIndex: 'groundPromotionFixedCommission', render: (value) => `${Number(value || 0).toFixed(2)} 元/单` },
                    {
                      title: '主色',
                      dataIndex: ['branding', 'primaryColor'],
                      render: (_, item) => <Space size={8}><span className="h-5 w-5 rounded border" style={{ backgroundColor: item.branding?.primaryColor || '#171717' }} />{item.branding?.primaryColor || '#171717'}</Space>,
                    },
                    {
                      title: '强调色',
                      dataIndex: ['branding', 'accentColor'],
                      render: (_, item) => <Space size={8}><span className="h-5 w-5 rounded border" style={{ backgroundColor: item.branding?.accentColor || '#0070f3' }} />{item.branding?.accentColor || '#0070f3'}</Space>,
                    },
                  ]}
                />
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Card title="专项管理入口" className="admin-panel-card">
                <Flex vertical gap={16}>
                  <Button block size="large" icon={<Sparkles size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/ai`)}>AI 管理</Button>
                  <Button block size="large" icon={<Settings2 size={16} />} onClick={() => router.push(`/enterprises/${enterprise._id}/automation`)}>自动化配置</Button>
                </Flex>
              </Card>
            </Col>
          </Row>
        </Flex>
      </PageContainer>

      <EnterpriseEditorDialog
        open={showEditor}
        onOpenChange={setShowEditor}
        enterprise={enterprise}
        onSaved={async () => { await mutate(); }}
      />
    </div>
  );
}
