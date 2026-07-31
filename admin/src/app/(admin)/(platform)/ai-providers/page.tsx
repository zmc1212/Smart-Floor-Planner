'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { Ellipsis, Images, Plus, RefreshCw, TestTube2, WalletCards } from 'lucide-react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { Button, Dropdown, Popconfirm, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { notify } from '@/components/ui/operation-feedback';
import type { Provider } from '@/components/ai-providers/types';

type ProviderAction = 'test' | 'models' | 'balance' | 'disable';

function ProviderState({ provider }: { provider: Provider }) {
  if (!provider.enabled) return <Tag color="default">已停用</Tag>;
  if (provider.lastTestOk === true) return <Tag color="success">连接正常</Tag>;
  if (provider.lastTestOk === false) return <Tag color="error">连接失败</Tag>;
  return <Tag>未测试</Tag>;
}

export default function AiProvidersPage() {
  const actionRef = useRef<ActionType>(null);
  const [workingId, setWorkingId] = useState('');

  const runAction = async (provider: Provider, action: ProviderAction) => {
    setWorkingId(`${provider.id}:${action}`);
    try {
      const response = await fetch(
        action === 'disable'
          ? `/api/admin/ai-providers/${provider.id}`
          : `/api/admin/ai-providers/${provider.id}/${action}`,
        { method: action === 'disable' ? 'DELETE' : 'POST' },
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
      await actionRef.current?.reload();
      notify.success(
        action === 'test'
          ? `连通成功，耗时 ${result.data.latencyMs}ms`
          : action === 'models'
            ? `已同步 ${result.data.models.length} 个模型`
            : action === 'balance'
              ? `上游余额：${result.data.balance} ${result.data.unit}`
              : '供应商已停用',
      );
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setWorkingId('');
    }
  };

  const columns: ProColumns<Provider>[] = [
    {
      title: '供应商',
      dataIndex: 'name',
      render: (_, provider) => (
        <Space direction="vertical" size={0}>
          <Link className="font-medium text-foreground hover:text-primary" href={`/ai-providers/${provider.id}`}>{provider.name}</Link>
          <Typography.Text type="secondary" className="font-mono text-xs">{provider.key}</Typography.Text>
        </Space>
      ),
    },
    { title: '适配器', dataIndex: 'adapterType', width: 170, render: (value) => <Tag>{value}</Tag> },
    {
      title: '路由',
      key: 'routing',
      width: 170,
      render: (_, provider) => <Space direction="vertical" size={0}><span>优先级 {provider.priority}</span><Typography.Text type="secondary" className="text-xs">{provider.timeoutMs} ms</Typography.Text></Space>,
    },
    { title: '凭证', dataIndex: 'apiKeyMasked', width: 150, render: (value) => <Typography.Text className="font-mono text-xs">{value || '未配置'}</Typography.Text> },
    {
      title: '能力',
      dataIndex: 'capabilities',
      width: 260,
      render: (_, provider) => <Space size={[4, 4]} wrap>{provider.capabilities.map((item) => <Tag key={item}>{item}</Tag>)}</Space>,
    },
    {
      title: '上游余额',
      key: 'balance',
      width: 180,
      render: (_, provider) => (
        <Space direction="vertical" size={0}>
          <span>{typeof provider.lastUpstreamBalance === 'number' ? `${provider.lastUpstreamBalance} ${provider.lastUpstreamBalanceUnit || ''}` : '未查询'}</span>
          {provider.lastUpstreamBalanceAt ? <Typography.Text type="secondary" className="text-xs">{new Date(provider.lastUpstreamBalanceAt).toLocaleString()}</Typography.Text> : null}
          {provider.lastUpstreamBalanceMessage ? <Typography.Text type="danger" ellipsis={{ tooltip: provider.lastUpstreamBalanceMessage }} className="max-w-36 text-xs">{provider.lastUpstreamBalanceMessage}</Typography.Text> : null}
        </Space>
      ),
    },
    { title: '状态', key: 'state', width: 120, render: (_, provider) => <ProviderState provider={provider} /> },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 120,
      render: (_, provider) => {
        const items: MenuProps['items'] = [
          { key: 'test', icon: <TestTube2 size={16} />, label: '连通测试', disabled: Boolean(workingId), onClick: () => runAction(provider, 'test') },
          { key: 'balance', icon: <WalletCards size={16} />, label: '查询上游余额', disabled: Boolean(workingId) || provider.adapterType !== 'grs', onClick: () => runAction(provider, 'balance') },
          { key: 'models', icon: <RefreshCw size={16} />, label: '同步模型', disabled: Boolean(workingId), onClick: () => runAction(provider, 'models') },
          provider.enabled ? { type: 'divider' } : null,
          provider.enabled ? {
            key: 'disable',
            danger: true,
            label: <Popconfirm title="停用供应商" description="停用后不会再接收新的路由请求。" onConfirm={() => runAction(provider, 'disable')} okText="停用" cancelText="取消"><span>停用供应商</span></Popconfirm>,
          } : null,
        ];
        return [
          <Button key="edit" type="link" href={`/ai-providers/${provider.id}`}>编辑</Button>,
          <Dropdown key="more" menu={{ items }} trigger={['click']}><Button aria-label={`${provider.name} 更多操作`} icon={<Ellipsis size={18} />} /></Dropdown>,
        ];
      },
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="AI 供应商"
        content="统一管理平台凭证、模型路由、优先级和成本快照。"
        extra={[
          <Button key="models" icon={<Images size={16} />} href="/ai-models">生图模型</Button>,
          <Button key="create" type="primary" icon={<Plus size={16} />} href="/ai-providers/new">新增供应商</Button>,
        ]}
      >
        <ProTable<Provider>
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          search={false}
          options={{ reload: true, density: true, setting: true }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 1260 }}
          request={async () => {
            const response = await fetch('/api/admin/ai-providers');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || '读取供应商失败');
            return { data: result.data || [], success: true, total: result.data?.length || 0 };
          }}
        />
      </PageContainer>
    </div>
  );
}
