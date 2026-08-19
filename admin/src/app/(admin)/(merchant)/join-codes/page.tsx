'use client';
/* eslint-disable @next/next/no-img-element -- QR codes are transient authenticated Blob URLs. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, Drawer, Flex, Space, Tag, Typography } from 'antd';
import { ArrowLeft, Download, Eye, RefreshCw, RotateCw, ShieldOff } from 'lucide-react';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { notify } from '@/components/ui/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type JoinCodeType = 'staff' | 'referrer';

type JoinCode = {
  id: string;
  codeType: JoinCodeType;
  status: string;
  version: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};

type JoinCodeEvent = {
  id: string;
  codeType: JoinCodeType;
  eventType: string;
  result: string;
  actorUserId: string | null;
  actorStaffId: string | null;
  createdAt: string;
};

const CODE_LABELS: Record<JoinCodeType, string> = {
  staff: '员工入驻码',
  referrer: '推荐人入驻码',
};

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function isActiveCode(code: JoinCode | undefined) {
  return Boolean(
    code &&
      code.status === 'active' &&
      (!code.expiresAt || new Date(code.expiresAt).getTime() > Date.now())
  );
}

export default function JoinCodesPage() {
  const confirm = useConfirmDialog();
  const { user } = useCurrentUser();
  const [codes, setCodes] = useState<JoinCode[]>([]);
  const [events, setEvents] = useState<JoinCodeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingType, setActingType] = useState<JoinCodeType | null>(null);
  const [onboardingCode, setOnboardingCode] = useState<{
    codeType: JoinCodeType;
    imageUrl: string;
    imageType: 'image/png' | 'image/jpeg';
  } | null>(null);
  const [globalTenantId, setGlobalTenantId] = useState('all');

  const requiresTenantSelection = Boolean(
    user && ['super_admin', 'admin'].includes(user.role) && globalTenantId === 'all'
  );

  const loadCodes = useCallback(async () => {
    if (requiresTenantSelection) return;
    setLoading(true);
    try {
      const response = await fetch('/api/enterprise/join-codes');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取入驻码失败');
      setCodes(result.data?.codes || []);
      setEvents(result.data?.events || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取入驻码失败');
    } finally {
      setLoading(false);
    }
  }, [requiresTenantSelection]);

  useEffect(() => {
    const tenant = document.cookie.split('; ').find((item) => item.startsWith('global_tenant_id='));
    setGlobalTenantId(tenant?.split('=')[1] || 'all');
  }, []);

  useEffect(() => {
    if (requiresTenantSelection) {
      setLoading(false);
      setCodes([]);
      setEvents([]);
      return;
    }
    void loadCodes();
  }, [loadCodes, requiresTenantSelection]);

  useEffect(() => {
    if (!onboardingCode) return;
    const timeout = window.setTimeout(() => setOnboardingCode(null), 90_000);
    return () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(onboardingCode.imageUrl);
    };
  }, [onboardingCode]);

  const codeByType = useMemo(() => {
    const result: Partial<Record<JoinCodeType, JoinCode>> = {};
    for (const code of codes) {
      if (!result[code.codeType]) result[code.codeType] = code;
    }
    return result;
  }, [codes]);

  const loadOnboardingCode = async (codeType: JoinCodeType, options: { confirm?: boolean } = {}) => {
    if (options.confirm !== false) {
      const accepted = await confirm({
        title: `查看${CODE_LABELS[codeType]}`,
        description: '将生成仅供当前企业使用的微信小程序码，90 秒后自动隐藏。请仅发送给需要入驻的人员。',
        confirmText: '生成二维码',
      });
      if (!accepted) return;
    }
    setActingType(codeType);
    try {
      const response = await fetch(`/api/enterprise/join-codes/${codeType}/image`, { method: 'POST' });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || '生成入驻二维码失败');
      }
      const image = await response.blob();
      if (image.type !== 'image/png' && image.type !== 'image/jpeg') {
        throw new Error('入驻二维码格式无效');
      }
      setOnboardingCode({ codeType, imageType: image.type, imageUrl: URL.createObjectURL(image) });
      notify.success(`${CODE_LABELS[codeType]}已生成，可供微信扫码入驻`);
      await loadCodes();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '生成入驻二维码失败');
    } finally {
      setActingType(null);
    }
  };

  const rotateCode = async (codeType: JoinCodeType) => {
    const accepted = await confirm({
      title: `换新${CODE_LABELS[codeType]}`,
      description: '换新后旧码立即失效。确认已通知仍在使用旧码的人员后再继续。',
      confirmText: '换新入驻码',
      destructive: true,
    });
    if (!accepted) return;
    setActingType(codeType);
    try {
      const response = await fetch(`/api/enterprise/join-codes/${codeType}/rotate`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '换新入驻码失败');
      notify.success(`${CODE_LABELS[codeType]}已换新，旧码已失效`);
      await loadCodes();
      await loadOnboardingCode(codeType, { confirm: false });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '换新入驻码失败');
    } finally {
      setActingType(null);
    }
  };

  const disableCode = async (codeType: JoinCodeType) => {
    const accepted = await confirm({
      title: `停用${CODE_LABELS[codeType]}`,
      description: '停用后不能继续用此码入驻；已建立的员工、推荐人关系和历史业务记录不会被修改。',
      confirmText: '停用入驻码',
      destructive: true,
    });
    if (!accepted) return;
    setActingType(codeType);
    try {
      const response = await fetch(`/api/enterprise/join-codes/${codeType}/disable`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '停用入驻码失败');
      setOnboardingCode(null);
      notify.success(`${CODE_LABELS[codeType]}已停用`);
      await loadCodes();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '停用入驻码失败');
    } finally {
      setActingType(null);
    }
  };

  const downloadOnboardingCode = () => {
    if (!onboardingCode) return;
    const link = document.createElement('a');
    link.href = onboardingCode.imageUrl;
    link.download = `${onboardingCode.codeType}-onboarding-code.${onboardingCode.imageType === 'image/jpeg' ? 'jpg' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const eventColumns: ProColumns<JoinCodeEvent>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (_, item) => formatTime(item.createdAt) },
    { title: '码类型', dataIndex: 'codeType', width: 120, render: (_, item) => CODE_LABELS[item.codeType] },
    { title: '动作', dataIndex: 'eventType', width: 140 },
    { title: '结果', dataIndex: 'result', width: 160, render: (_, item) => <Tag color={item.result === 'active' || item.result === 'joined' ? 'green' : 'default'}>{item.result}</Tag> },
    { title: '操作者', key: 'actor', render: (_, item) => item.actorStaffId ? `员工 #${item.actorStaffId}` : item.actorUserId ? `用户 #${item.actorUserId}` : '系统/匿名扫码' },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="入驻码"
        content="管理当前企业的员工入驻码和推荐人入驻码。后台不展示令牌明文；已入驻关系不会因换码或停用而被改写。"
        extra={(
          <Space>
            <Link href="/referrer-network-operations"><Button icon={<ArrowLeft size={16} />}>返回运营工作台</Button></Link>
            <Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void loadCodes()}>刷新</Button>
          </Space>
        )}
      >
        {requiresTenantSelection ? (
          <Alert showIcon type="info" message="请先选择企业" description="平台管理员需要先在左侧导航切换到具体企业，才能查看或管理该企业的入驻码。" />
        ) : (
          <Flex vertical gap={20}>
            <section id="enterprise-join-codes" aria-label="入驻码管理">
              <Typography.Title level={4}>企业双码</Typography.Title>
              <div className="grid gap-4 lg:grid-cols-2">
                {(['staff', 'referrer'] as JoinCodeType[]).map((type) => {
                  const code = codeByType[type];
                  const active = isActiveCode(code);
                  return (
                    <Card key={type} loading={loading} title={CODE_LABELS[type]} extra={<Tag color={active ? 'green' : 'default'}>{active ? '生效中' : '未生效'}</Tag>}>
                      <Descriptions size="small" column={2} items={[
                        { key: 'version', label: '版本', children: code ? `v${code.version}` : '尚未创建' },
                        { key: 'expiry', label: '失效时间', children: code?.expiresAt ? formatTime(code.expiresAt) : '未设置' },
                        { key: 'created', label: '创建时间', children: formatTime(code?.createdAt) },
                        { key: 'disabled', label: '停用时间', children: formatTime(code?.disabledAt) },
                      ]} />
                      <Space wrap className="mt-4">
                        {active ? <Button icon={<Eye size={15} />} loading={actingType === type} onClick={() => void loadOnboardingCode(type)}>查看二维码</Button> : null}
                        <Button type="primary" danger={active} icon={<RotateCw size={15} />} loading={actingType === type} onClick={() => void rotateCode(type)}>{active ? '换新' : '创建入驻码'}</Button>
                        {active ? <Button danger icon={<ShieldOff size={15} />} loading={actingType === type} onClick={() => void disableCode(type)}>停用</Button> : null}
                      </Space>
                    </Card>
                  );
                })}
              </div>
            </section>

            <section aria-label="双码审计">
              <Typography.Title level={4}>双码审计</Typography.Title>
              <ProTable<JoinCodeEvent> rowKey="id" loading={loading} dataSource={events} columns={eventColumns} search={false} options={false} pagination={{ defaultPageSize: 10, showSizeChanger: true }} scroll={{ x: 760 }} />
            </section>
          </Flex>
        )}
      </PageContainer>

      <Drawer open={Boolean(onboardingCode)} title={onboardingCode ? CODE_LABELS[onboardingCode.codeType] : '入驻二维码'} width={560} destroyOnHidden onClose={() => setOnboardingCode(null)}>
        <Flex vertical gap={16}>
          <Alert showIcon type="warning" message="受控短时展示" description="二维码将在 90 秒后自动隐藏；旧码换新或停用后，已保存二维码也会立即失效。请仅发送给需要入驻当前企业的人员。" />
          <Flex vertical align="center" gap={12} className="rounded-lg bg-slate-50 p-6">
            {onboardingCode ? <img src={onboardingCode.imageUrl} alt={`${CODE_LABELS[onboardingCode.codeType]}微信小程序码`} className="h-72 w-72 max-w-full rounded bg-white p-2" /> : null}
            <Typography.Text type="secondary">微信扫一扫，进入小程序后完成入驻</Typography.Text>
          </Flex>
          <Button type="primary" icon={<Download size={16} />} onClick={downloadOnboardingCode}>下载二维码</Button>
        </Flex>
      </Drawer>
    </div>
  );
}
