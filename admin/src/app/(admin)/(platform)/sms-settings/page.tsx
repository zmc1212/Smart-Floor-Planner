'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Result,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { MessageSquareText, RefreshCw, Send } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { notify } from '@/components/admin/operation-feedback';
import { SMS_COPY } from '@/lib/sms-copy';

type Provider = 'aliyun' | 'tencent';
type ProviderConfig = {
  signName: string;
  templateCode: string;
  region: string;
  sdkAppId?: string;
  accessKeyIdMasked?: string;
  secretKeyMasked?: string;
  secretIdMasked?: string;
  hasAccessKeyId: boolean;
  hasSecretKey: boolean;
  hasSecretId: boolean;
  accessKeyId?: string;
  secretKey?: string;
  secretId?: string;
};
type SmsConfig = { enabled: boolean; activeProvider: Provider; ready: boolean; providers: Record<Provider, ProviderConfig> };
type Log = { id: string; status: string; provider: string; kind: string; phoneMasked: string; recipientName?: string | null; leadName?: string | null; enterpriseName?: string | null; errorMessage?: string | null; attemptCount: number; createdAt: string; sentAt?: string | null };

const PROVIDER_LABELS: Record<Provider, string> = { aliyun: '阿里云短信', tencent: '腾讯云短信' };
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '发送中', color: 'processing' },
  sent: { label: '已提交', color: 'success' },
  failed: { label: '发送失败', color: 'error' },
  skipped: { label: '已跳过', color: 'warning' },
};

function blankProvider(provider: Provider): ProviderConfig {
  return { signName: '', templateCode: '', region: provider === 'aliyun' ? 'cn-hangzhou' : 'ap-guangzhou', sdkAppId: '', hasAccessKeyId: false, hasSecretKey: false, hasSecretId: false };
}

export default function SmsSettingsPage() {
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [config, setConfig] = useState<SmsConfig>({ enabled: false, activeProvider: 'aliyun', ready: false, providers: { aliyun: blankProvider('aliyun'), tencent: blankProvider('tencent') } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [logs, setLogs] = useState<Log[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const provider = config.providers[config.activeProvider];

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const response = await fetch('/api/platform/sms-config');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取短信配置失败');
      setConfig({ ...result.data, providers: { aliyun: { ...blankProvider('aliyun'), ...result.data.providers.aliyun }, tencent: { ...blankProvider('tencent'), ...result.data.providers.tencent } } });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取短信配置失败');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  const loadLogs = useCallback(async () => {
    if (!canManage) return;
    setLogsLoading(true);
    try {
      const response = await fetch('/api/platform/sms-delivery-logs?page=1&limit=30');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取短信送达记录失败');
      setLogs(result.data || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取短信送达记录失败');
    } finally {
      setLogsLoading(false);
    }
  }, [canManage]);

  useEffect(() => { void load(); void loadLogs(); }, [load, loadLogs]);

  const updateProvider = (patch: Partial<ProviderConfig>) => {
    setConfig((current) => ({ ...current, providers: { ...current.providers, [current.activeProvider]: { ...current.providers[current.activeProvider], ...patch } } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const current = config.providers[config.activeProvider];
      const payload: Record<string, unknown> = { enabled: config.enabled, activeProvider: config.activeProvider, providers: { [config.activeProvider]: { signName: current.signName, templateCode: current.templateCode, region: current.region, ...(config.activeProvider === 'aliyun' ? { accessKeyId: current.accessKeyId, secretKey: current.secretKey } : { secretId: current.secretId, secretKey: current.secretKey, sdkAppId: current.sdkAppId }) } } };
      const response = await fetch('/api/platform/sms-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存短信配置失败');
      setConfig({ ...result.data, providers: { aliyun: { ...blankProvider('aliyun'), ...result.data.providers.aliyun }, tencent: { ...blankProvider('tencent'), ...result.data.providers.tencent } } });
      notify.success('短信配置已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存短信配置失败');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/platform/sms-config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: testPhone }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '测试短信发送失败');
      notify.success('测试短信已提交');
      await loadLogs();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '测试短信发送失败');
    } finally {
      setTesting(false);
    }
  };

  const retry = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/platform/sms-delivery-logs/${id}/retry`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '重试短信失败');
      notify.success('短信重试请求已提交');
      await loadLogs();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重试短信失败');
    }
  }, [loadLogs]);

  const columns = useMemo(() => [
    { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={STATUS_META[value]?.color}>{STATUS_META[value]?.label || value}</Tag> },
    { title: '类型', dataIndex: 'kind', width: 100, render: (value: string) => value === 'test' ? '测试短信' : '设计师派单' },
    { title: '接收人', key: 'recipient', render: (_: unknown, row: Log) => <Flex vertical gap={2}><Typography.Text strong>{row.recipientName || '测试号码'}</Typography.Text><Typography.Text type="secondary">{row.phoneMasked}</Typography.Text></Flex> },
    { title: '企业 / 线索', key: 'business', render: (_: unknown, row: Log) => `${row.enterpriseName || '-'} / ${row.leadName || '-'}` },
    { title: '供应商', dataIndex: 'provider', render: (value: Provider) => PROVIDER_LABELS[value] || value },
    { title: '结果说明', dataIndex: 'errorMessage', ellipsis: true, render: (value: string | null, row: Log) => value || (row.status === 'sent' ? '供应商已接受请求' : '-') },
    { title: '操作', key: 'action', width: 100, render: (_: unknown, row: Log) => row.status === 'failed' ? <Button type="link" onClick={() => void retry(row.id)}>重试</Button> : null },
  ], [retry]);

  if (user && !canManage) return <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以配置短信能力。" />;

  return <PageContainer title="短信设置" subTitle="配置阿里云或腾讯云短信，并查看设计师派单提醒送达情况">
    <Flex vertical gap={16}>
      <Card loading={loading} className="admin-panel-card">
        <Flex vertical gap={16}>
          <Alert showIcon type="info" message="短信只发送给设计师" description="线索成功归属设计师后发送；测量员仍使用现有站内和微信通知。短信失败不会影响派单结果。" />
          <Flex align="center" justify="space-between" wrap="wrap" gap={12}>
            <Space><MessageSquareText size={18} /><Typography.Text strong>启用短信通知</Typography.Text><Tag color={config.ready ? 'green' : 'gold'}>{config.ready ? '配置就绪' : '未就绪'}</Tag></Space>
            <Switch checked={config.enabled} onChange={(enabled) => setConfig((current) => ({ ...current, enabled }))} />
          </Flex>
          <Divider className="!my-1" />
          <Space direction="vertical" className="w-full" size={12}>
            <Typography.Text strong>主供应商</Typography.Text>
            <Select value={config.activeProvider} onChange={(value: Provider) => setConfig((current) => ({ ...current, activeProvider: value }))} options={Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }))} className="w-full max-w-sm" />
            <Flex gap={12} wrap="wrap">
              {config.activeProvider === 'aliyun' ? <>
                <Input placeholder="AccessKey ID" value={provider.accessKeyId} onChange={(event) => updateProvider({ accessKeyId: event.target.value })} className="min-w-[260px] flex-1" addonBefore="AccessKey ID" />
                <Input.Password placeholder={provider.hasSecretKey ? '已配置，留空保持不变' : 'Secret'} value={provider.secretKey} onChange={(event) => updateProvider({ secretKey: event.target.value })} className="min-w-[260px] flex-1" addonBefore="Secret" />
              </> : <>
                <Input placeholder="SecretId" value={provider.secretId} onChange={(event) => updateProvider({ secretId: event.target.value })} className="min-w-[260px] flex-1" addonBefore="SecretId" />
                <Input.Password placeholder={provider.hasSecretKey ? '已配置，留空保持不变' : 'SecretKey'} value={provider.secretKey} onChange={(event) => updateProvider({ secretKey: event.target.value })} className="min-w-[260px] flex-1" addonBefore="SecretKey" />
                <Input placeholder="短信 SDK AppID" value={provider.sdkAppId} onChange={(event) => updateProvider({ sdkAppId: event.target.value })} className="min-w-[260px] flex-1" addonBefore="SDK AppID" />
              </>}
            </Flex>
            <Flex gap={12} wrap="wrap">
              <Input placeholder="短信签名" value={provider.signName} onChange={(event) => updateProvider({ signName: event.target.value })} className="min-w-[220px] flex-1" addonBefore="签名" />
              <Input placeholder="已审核模板 ID" value={provider.templateCode} onChange={(event) => updateProvider({ templateCode: event.target.value })} className="min-w-[260px] flex-1" addonBefore="模板 ID" />
              <Input placeholder="区域" value={provider.region} onChange={(event) => updateProvider({ region: event.target.value })} className="min-w-[180px] flex-1" addonBefore="区域" />
            </Flex>
            <Typography.Paragraph type="secondary" className="!mb-0">模板正文：{SMS_COPY}</Typography.Paragraph>
          </Space>
          <Flex justify="end"><Button type="primary" loading={saving} onClick={() => void save()}>保存配置</Button></Flex>
        </Flex>
      </Card>
      <Card title="发送测试短信" className="admin-panel-card">
        <Flex gap={12} wrap="wrap"><Input placeholder="请输入接收测试短信的手机号" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} className="max-w-sm" /><Button icon={<Send size={16} />} loading={testing} onClick={() => void sendTest()}>发送测试</Button></Flex>
      </Card>
      <Card title={<Flex justify="space-between" align="center"><span>短信送达记录</span><Button icon={<RefreshCw size={15} />} loading={logsLoading} onClick={() => void loadLogs()}>刷新</Button></Flex>} className="admin-panel-card">
        <Table rowKey="id" loading={logsLoading} columns={columns} dataSource={logs} pagination={false} scroll={{ x: 1000 }} size="small" />
      </Card>
    </Flex>
  </PageContainer>;
}
