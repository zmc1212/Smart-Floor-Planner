'use client';

import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Cloud,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  TestTube2,
  XCircle,
} from 'lucide-react';
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProTable,
  type ProColumns,
} from '@ant-design/pro-components';
import { Alert, Button, Card, Dropdown, Flex, Modal, Result, Skeleton, Space, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { useFetch } from '@/hooks/useFetch';

type StorageStats = {
  activeCount: number;
  activeBytes: number;
  pendingPurgeCount: number;
  pendingPurgeBytes: number;
  totalCount: number;
  totalBytes: number;
};

type QiniuConfig = {
  id: string;
  key: string;
  name: string;
  driver: 'qiniu';
  accessKeyMasked: string;
  secretKeyMasked: string;
  bucket: string;
  region: string;
  domain: string;
  objectPrefix: string;
  status: 'active' | 'archived';
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string;
  archivedAt: string | null;
  stats: StorageStats | null;
};

type LocalConfig = {
  id: 'local';
  key: 'local';
  name: string;
  driver: 'local';
  status: 'active';
  persistent: boolean;
  storageDirectoryConfigured: boolean;
  stats: StorageStats | null;
};

type MediaStorageData = {
  activeProviderKey: string;
  activatedAt: string | null;
  grsOutputPersistence: { enabled: boolean };
  encryption: { ready: boolean; dedicated: boolean };
  local: LocalConfig;
  configs: QiniuConfig[];
};

type StorageRow = LocalConfig | QiniuConfig;

type StorageForm = {
  key: string;
  name: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  region: string;
  domain: string;
  objectPrefix?: string;
};

type ConfirmAction = {
  type: 'activate' | 'archive';
  row: StorageRow;
};

const REGION_OPTIONS = [
  { value: 'z0', label: '华东-浙江' },
  { value: 'cn-east-2', label: '华东-浙江 2' },
  { value: 'z1', label: '华北-河北' },
  { value: 'z2', label: '华南-广东' },
  { value: 'na0', label: '北美-洛杉矶' },
  { value: 'as0', label: '亚太-新加坡' },
];

const EMPTY_FORM: StorageForm = {
  key: '',
  name: '',
  accessKey: '',
  secretKey: '',
  bucket: '',
  region: 'z0',
  domain: 'https://',
  objectPrefix: '',
};

function toEditForm(config: QiniuConfig): StorageForm {
  return {
    key: config.key,
    name: config.name,
    accessKey: '',
    secretKey: '',
    bucket: config.bucket,
    region: config.region,
    domain: config.domain,
    objectPrefix: config.objectPrefix || '',
  };
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function AssetStats({ stats }: { stats: StorageStats | null }) {
  return (
    <Flex vertical gap={2}>
      <Typography.Text>{stats?.activeCount || 0} 个 / {formatBytes(stats?.activeBytes)}</Typography.Text>
      <Typography.Text type="secondary" className="text-xs">
        待清理 {stats?.pendingPurgeCount || 0} 个 / {formatBytes(stats?.pendingPurgeBytes)}
      </Typography.Text>
      <Typography.Text type="secondary" className="text-xs">
        累计 {stats?.totalCount || 0} 个 / {formatBytes(stats?.totalBytes)}
      </Typography.Text>
    </Flex>
  );
}

function ConnectionStatus({ row }: { row: StorageRow }) {
  if (row.driver === 'local') return <Tag color="processing">内置</Tag>;
  if (row.status === 'archived') return <Tag>已归档</Tag>;
  if (row.lastTestOk === true) return <Tag color="success" icon={<CheckCircle2 size={13} />}>测试通过</Tag>;
  if (row.lastTestOk === false) return <Tag color="error" icon={<XCircle size={13} />}>测试失败</Tag>;
  return <Tag>待测试</Tag>;
}

export default function MediaStoragePage() {
  const { data, isLoading, error, mutate } = useFetch<MediaStorageData>('/api/admin/media-storage');
  const [editingConfig, setEditingConfig] = useState<QiniuConfig | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [workingKey, setWorkingKey] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const rows = useMemo<StorageRow[]>(
    () => data ? [data.local, ...data.configs] : [],
    [data],
  );
  const activeConfig = data?.activeProviderKey === 'local'
    ? data.local
    : data?.configs.find((config) => config.key === data?.activeProviderKey);
  const activeQiniuConfig = data?.configs.find((config) => config.key === data?.activeProviderKey);
  const canEnableGrsOutputPersistence = activeQiniuConfig?.lastTestOk === true;
  const isCreateModalOpen = editingConfig === null;
  const isEditModalOpen = Boolean(editingConfig);
  const isFormOpen = isCreateModalOpen || isEditModalOpen;

  async function requestAction(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
    return result.data;
  }

  const save = async (values: StorageForm) => {
    setSaving(true);
    try {
      const editing = editingConfig && editingConfig.id;
      await requestAction(editing ? `/api/admin/media-storage/${editing}` : '/api/admin/media-storage', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, key: values.key.trim().toLowerCase(), driver: 'qiniu' }),
      });
      await mutate();
      setEditingConfig(undefined);
      notify.success(editing ? '媒体存储配置已更新' : '媒体存储配置已创建，请先执行连通性测试');
      return true;
    } catch (saveError) {
      notify.error(saveError instanceof Error ? saveError.message : '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (row: StorageRow) => {
    setWorkingKey(`${row.key}:test`);
    try {
      await requestAction(`/api/admin/media-storage/${row.id}/test`, { method: 'POST' });
      await mutate();
      notify.success(row.driver === 'local' ? '本地存储读写删除测试通过' : '七牛云完整连通性测试通过');
    } catch (testError) {
      await mutate();
      notify.error(testError instanceof Error ? testError.message : '连通性测试失败');
    } finally {
      setWorkingKey('');
    }
  };

  const setGrsOutputPersistence = async (enabled: boolean) => {
    setWorkingKey('grs-output-persistence');
    try {
      await requestAction('/api/admin/media-storage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persistGrsAiOutputs: enabled }),
      });
      await mutate();
      notify.success(enabled ? '后续 GRS 结果图将转存到当前七牛云配置' : '后续 GRS 结果图将保留上游 URL');
    } catch (policyError) {
      notify.error(policyError instanceof Error ? policyError.message : '更新 GRS 结果图存储策略失败');
    } finally {
      setWorkingKey('');
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    const { row, type } = confirmAction;
    setWorkingKey(`${row.key}:${type}`);
    try {
      await requestAction(
        `/api/admin/media-storage/${row.id}${type === 'activate' ? '/activate' : ''}`,
        { method: type === 'activate' ? 'POST' : 'DELETE' },
      );
      await mutate();
      notify.success(type === 'activate' ? `${row.name} 已设为默认存储` : `${row.name} 已归档`);
      setConfirmAction(null);
    } catch (actionError) {
      notify.error(actionError instanceof Error ? actionError.message : '操作失败');
    } finally {
      setWorkingKey('');
    }
  };

  const columns: ProColumns<StorageRow>[] = [
    {
      title: '存储配置',
      dataIndex: 'name',
      width: 230,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Space size={8}>
            {row.driver === 'local' ? <HardDrive size={16} /> : <Cloud size={16} />}
            <Typography.Text strong>{row.name}</Typography.Text>
          </Space>
          <Typography.Text type="secondary" className="font-mono text-xs">{row.key}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '位置与凭证',
      key: 'location',
      width: 310,
      render: (_, row) => row.driver === 'local' ? (
        <Space direction="vertical" size={0}>
          <Typography.Text>服务器本地持久化目录</Typography.Text>
          <Typography.Text type={row.persistent ? 'success' : 'warning'} className="text-xs">
            {row.persistent ? '已配置持久化目录' : '未显式配置持久化目录'}
          </Typography.Text>
        </Space>
      ) : (
        <Space direction="vertical" size={0}>
          <Typography.Text>{row.bucket} · {row.region}</Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: row.domain }} className="max-w-72 text-xs">
            {row.domain}
          </Typography.Text>
          <Typography.Text type="secondary" className="font-mono text-xs">
            {row.accessKeyMasked} · {row.secretKeyMasked}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '资产',
      key: 'assets',
      width: 210,
      render: (_, row) => <AssetStats stats={row.stats} />,
    },
    {
      title: '状态',
      key: 'status',
      width: 170,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          {data?.activeProviderKey === row.key ? <Tag color="green">当前默认</Tag> : null}
          <ConnectionStatus row={row} />
        </Space>
      ),
    },
    {
      title: '最近测试',
      key: 'lastTest',
      width: 240,
      render: (_, row) => row.driver === 'local' ? <Typography.Text type="secondary">本地探针按需执行</Typography.Text> : (
        <Space direction="vertical" size={0}>
          <Typography.Text ellipsis={{ tooltip: row.lastTestMessage || undefined }} className="max-w-52 text-xs">
            {row.lastTestMessage || '尚未执行连通性测试'}
          </Typography.Text>
          {row.lastTestedAt ? <Typography.Text type="secondary" className="text-xs">{new Date(row.lastTestedAt).toLocaleString()}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 112,
      render: (_, row) => {
        const archived = row.driver === 'qiniu' && row.status === 'archived';
        const canActivate = row.driver === 'local' || row.lastTestOk === true;
        const items: MenuProps['items'] = [
          row.driver === 'qiniu' && !archived ? {
            key: 'edit',
            icon: <Pencil size={16} />,
            label: '编辑 / 轮换密钥',
            disabled: Boolean(workingKey),
            onClick: () => setEditingConfig(row),
          } : null,
          !archived ? {
            key: 'test',
            icon: <TestTube2 size={16} />,
            label: '连通性测试',
            disabled: Boolean(workingKey),
            onClick: () => testConnection(row),
          } : null,
          data?.activeProviderKey !== row.key && !archived ? {
            key: 'activate',
            icon: <ShieldCheck size={16} />,
            label: '设为默认',
            disabled: Boolean(workingKey) || !canActivate,
            onClick: () => setConfirmAction({ type: 'activate', row }),
          } : null,
          row.driver === 'qiniu' && data?.activeProviderKey !== row.key && !archived ? { type: 'divider' } : null,
          row.driver === 'qiniu' && data?.activeProviderKey !== row.key && !archived ? {
            key: 'archive',
            icon: <Archive size={16} />,
            danger: true,
            label: '归档配置',
            disabled: Boolean(workingKey),
            onClick: () => setConfirmAction({ type: 'archive', row }),
          } : null,
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']}>
            <Button size="small" aria-label={`${row.name} 更多操作`} icon={workingKey.startsWith(`${row.key}:`) ? <RefreshCw className="animate-spin" size={16} /> : <MoreHorizontal size={16} />} />
          </Dropdown>
        );
      },
    },
  ];

  if (isLoading) {
    return <div className="admin-page-frame"><Skeleton active paragraph={{ rows: 10 }} /></div>;
  }

  if (!data || error) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="媒体存储">
          <Result status="error" title="媒体存储配置加载失败" subTitle="请刷新后重试。" />
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="媒体存储"
        content="统一管理服务器本地存储和七牛云私有空间。切换默认配置只影响后续上传资产。"
        extra={[
          <Button key="create" type="primary" icon={<Plus size={16} />} disabled={!data.encryption.ready} onClick={() => setEditingConfig(null)}>
            新增七牛配置
          </Button>,
        ]}
      >
        <Flex vertical gap={24} className="admin-config-stack">
          {!data.encryption.ready ? (
            <Alert
              type="error"
              showIcon
              message="云存储凭证不可保存"
              description={<>当前环境缺少 <Typography.Text code>MEDIA_STORAGE_KEY_ENCRYPTION_SECRET</Typography.Text>，请配置后再保存云存储凭证。</>}
            />
          ) : !data.encryption.dedicated ? (
            <Alert
              type="warning"
              showIcon
              message="正在使用兼容加密密钥"
              description={<>正式部署建议单独配置 <Typography.Text code>MEDIA_STORAGE_KEY_ENCRYPTION_SECRET</Typography.Text>，以便独立轮换凭证。</>}
            />
          ) : null}

          <Card title="当前默认存储" className="admin-panel-card">
            <Flex justify="space-between" gap={24} wrap="wrap" align="center">
              <Flex vertical gap={4}>
                <Space size={8}>
                  <ShieldCheck className="text-primary" size={18} />
                  <Typography.Text strong>{activeConfig?.name || data.activeProviderKey}</Typography.Text>
                  <Tag>{data.activeProviderKey}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  {data.activatedAt ? `最后切换：${new Date(data.activatedAt).toLocaleString()}` : '尚未通过后台切换，使用兼容默认值'}
                </Typography.Text>
              </Flex>
              <Typography.Text type="secondary">历史资产始终按自身的 storageProvider 读取</Typography.Text>
            </Flex>
          </Card>

          <Card title="GRS AI 结果图存储" className="admin-panel-card">
            <Flex justify="space-between" gap={24} wrap="wrap" align="center">
              <Flex vertical gap={4}>
                <Typography.Text strong>
                  {data.grsOutputPersistence.enabled
                    ? `已启用：转存至 ${activeConfig?.name || data.activeProviderKey}`
                    : '未启用：直接使用 GRS 图片 URL'}
                </Typography.Text>
                <Typography.Text type="secondary">
                  默认不额外占用平台存储；转存只影响后续 GRS 结果，历史结果不会迁移。
                </Typography.Text>
                {!data.grsOutputPersistence.enabled && !canEnableGrsOutputPersistence ? (
                  <Typography.Text type="warning">请先将测试通过的七牛配置设为默认，才能启用转存。</Typography.Text>
                ) : null}
              </Flex>
              <Button
                type={data.grsOutputPersistence.enabled ? 'default' : 'primary'}
                loading={workingKey === 'grs-output-persistence'}
                disabled={Boolean(workingKey) || (!data.grsOutputPersistence.enabled && !canEnableGrsOutputPersistence)}
                onClick={() => setGrsOutputPersistence(!data.grsOutputPersistence.enabled)}
              >
                {data.grsOutputPersistence.enabled ? '关闭转存' : '启用七牛转存'}
              </Button>
            </Flex>
          </Card>

          <ProTable<StorageRow>
            rowKey="key"
            columns={columns}
            dataSource={rows}
            search={false}
            options={{ reload: () => mutate(), density: true, setting: true }}
            pagination={false}
            scroll={{ x: 1270 }}
          />
        </Flex>
      </PageContainer>

      <ModalForm<StorageForm>
        key={editingConfig?.id || 'new'}
        title={isEditModalOpen ? '编辑七牛云配置' : '新增七牛云配置'}
        open={isFormOpen}
        initialValues={editingConfig ? toEditForm(editingConfig) : EMPTY_FORM}
        modalProps={{
          destroyOnHidden: true,
          maskClosable: false,
          onCancel: () => setEditingConfig(undefined),
        }}
        onOpenChange={(open) => !open && setEditingConfig(undefined)}
        onFinish={save}
        submitter={{
          searchConfig: { submitText: saving ? '保存中…' : '保存配置' },
          submitButtonProps: { loading: saving },
          render: (_, dom) => <Flex justify="end" gap={12} style={{ marginTop: 24 }}>{dom}</Flex>,
        }}
      >
        <Alert
          type="info"
          showIcon
          message="凭证仅在服务端加密保存"
          description="存储空间（Bucket）必须为私有空间。编辑时留空访问密钥和私钥可保留原凭证。"
          style={{ marginBottom: 16 }}
        />
        <ProFormText
          name="key"
          label="配置标识"
          disabled={isEditModalOpen}
          rules={[{ required: true, message: '请输入配置标识' }]}
          fieldProps={{ placeholder: 'qiniu-primary', autoComplete: 'off' }}
          extra="创建后不可修改，资产会保存此稳定标识。"
        />
        <ProFormText name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} fieldProps={{ placeholder: '七牛主存储' }} />
        <ProFormText.Password
          name="accessKey"
          label={isEditModalOpen ? '访问密钥（留空保留）' : '访问密钥'}
          rules={isEditModalOpen ? [] : [{ required: true, message: '请输入 AccessKey' }]}
          fieldProps={{ autoComplete: 'new-password' }}
        />
        <ProFormText.Password
          name="secretKey"
          label={isEditModalOpen ? '私钥（留空保留）' : '私钥'}
          rules={isEditModalOpen ? [] : [{ required: true, message: '请输入 SecretKey' }]}
          fieldProps={{ autoComplete: 'new-password' }}
        />
        <ProFormText name="bucket" label="存储空间（Bucket）" rules={[{ required: true, message: '请输入存储空间名称' }]} fieldProps={{ placeholder: 'private-media' }} />
        <ProFormSelect name="region" label="区域" options={REGION_OPTIONS} rules={[{ required: true, message: '请选择区域' }]} />
        <ProFormText
          name="objectPrefix"
          label="存储前缀（可选）"
          fieldProps={{ placeholder: 'smart-floor/ai-assets/' }}
          extra="只影响后续上传与健康探针；历史资产位置不会改变。"
        />
        <ProFormText
          name="domain"
          label="HTTPS 下载域名"
          rules={[{ required: true, message: '请输入 HTTPS 下载域名' }]}
          fieldProps={{ placeholder: 'https://media.example.com' }}
          extra="仅填写域名根地址，并加入微信小程序下载合法域名。"
        />
      </ModalForm>

      <Modal
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'activate' ? '确认切换默认媒体存储' : '确认归档媒体存储配置'}
        okText={confirmAction?.type === 'activate' ? '确认切换' : '确认归档'}
        cancelText="取消"
        okButtonProps={{ danger: confirmAction?.type === 'archive', loading: Boolean(confirmAction && workingKey.endsWith(`:${confirmAction.type}`)) }}
        onCancel={() => setConfirmAction(null)}
        onOk={runConfirmedAction}
      >
        <Typography.Paragraph className="!mb-0">
          {confirmAction?.type === 'activate'
            ? `切换后仅新上传资产写入“${confirmAction.row.name}”，历史资产位置不会变化。`
            : `归档后“${confirmAction?.row.name}”不能再写入、测试或重新激活，但仍会继续读取和删除历史资产。`}
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
