'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Result, Segmented, Space, Tag, Typography } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { QrCode } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { notify } from '@/components/ui/operation-feedback';

type CodeEnvironment = 'develop' | 'trial' | 'release';

const ENVIRONMENT_META: Record<CodeEnvironment, { label: string; detail: string; color: string }> = {
  develop: { label: '开发版', detail: '仅已加入开发者名单的微信账号可扫码打开。', color: 'blue' },
  trial: { label: '体验版', detail: '生成当前体验版小程序码，适合验收和测试分发。', color: 'gold' },
  release: { label: '正式版', detail: '生成线上正式发布的小程序码。', color: 'green' },
};

export default function MiniProgramCodeSettingsPage() {
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [environment, setEnvironment] = useState<CodeEnvironment>('develop');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/platform/mini-program-code-config');
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取小程序码环境失败');
        setEnvironment(result.data.environment);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : '读取小程序码环境失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [canManage]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/platform/mini-program-code-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存小程序码环境失败');
      setEnvironment(result.data.environment);
      notify.success(`已切换为${ENVIRONMENT_META[result.data.environment as CodeEnvironment].label}，新生成的小程序码将立即使用该环境。`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存小程序码环境失败');
    } finally {
      setSaving(false);
    }
  };

  if (user && !canManage) {
    return <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以切换全局小程序码环境。" />;
  }

  const meta = ENVIRONMENT_META[environment];
  return (
    <PageContainer title="小程序码环境" subTitle="统一控制后台生成的入驻码、推广码和员工活动码">
      <Card loading={loading} className="admin-panel-card">
        <Space direction="vertical" size={20} className="w-full">
          <Alert
            showIcon
            type={environment === 'release' ? 'warning' : 'info'}
            message="仅影响切换后新生成的小程序码"
            description="已下载或已发送的历史小程序码不会被改写；切换后请重新生成并分发需要更新的码。"
          />
          <div>
            <Typography.Title level={5}><Space><QrCode size={18} />生成环境 <Tag color={meta.color}>{meta.label}</Tag></Space></Typography.Title>
            <Typography.Paragraph type="secondary">{meta.detail}</Typography.Paragraph>
            <Segmented<CodeEnvironment>
              block
              value={environment}
              options={(['develop', 'trial', 'release'] as CodeEnvironment[]).map((value) => ({
                label: ENVIRONMENT_META[value].label,
                value,
              }))}
              onChange={setEnvironment}
            />
          </div>
          <Space>
            <Button type="primary" loading={saving} onClick={() => void save()}>保存并立即生效</Button>
          </Space>
        </Space>
      </Card>
    </PageContainer>
  );
}
