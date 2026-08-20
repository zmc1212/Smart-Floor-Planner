'use client';
/* eslint-disable @next/next/no-img-element -- QR codes are transient authenticated Blob URLs. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, Drawer, Flex, Result, Space, Tag, Typography } from 'antd';
import { Copy, Download, Eye, RefreshCw, RotateCw, ShieldOff } from 'lucide-react';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type RegistrationCode = {
  id: string;
  status: string;
  version: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};

type RegistrationCodeEvent = {
  id: string;
  registrationCodeId: string;
  eventType: string;
  result: string;
  actorUserId: string | null;
  actorStaffId: string | null;
  createdAt: string;
};

function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function isActiveCode(code: RegistrationCode | null) {
  return Boolean(
    code &&
      code.status === 'active' &&
      (!code.expiresAt || new Date(code.expiresAt).getTime() > Date.now())
  );
}

export default function EnterpriseRegistrationCodesPage() {
  const confirm = useConfirmDialog();
  const { user } = useCurrentUser();
  const canManage = Boolean(user && ['super_admin', 'admin'].includes(user.role));
  const [code, setCode] = useState<RegistrationCode | null>(null);
  const [events, setEvents] = useState<RegistrationCodeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [qrCode, setQrCode] = useState<{
    imageUrl: string;
    imageType: 'image/png' | 'image/jpeg';
  } | null>(null);

  const loadCodes = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/enterprise-registration-codes');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取企业开户码失败');
      }
      setCode(result.data?.code || null);
      setEvents(result.data?.events || []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取企业开户码失败');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void loadCodes();
  }, [canManage, loadCodes]);

  useEffect(() => {
    if (!qrCode) return;
    const timeout = window.setTimeout(() => setQrCode(null), 90_000);
    return () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(qrCode.imageUrl);
    };
  }, [qrCode]);

  const loadQr = async (options: { confirm?: boolean } = {}) => {
    if (options.confirm !== false) {
      const accepted = await confirm({
        title: '查看企业开户码',
        description:
          '将生成平台级微信小程序开户码，90 秒后自动隐藏。请仅发送给需要申请开户的企业联系人。',
        confirmText: '生成二维码',
      });
      if (!accepted) return;
    }
    setActing(true);
    try {
      const response = await fetch(
        '/api/admin/enterprise-registration-codes/image',
        { method: 'POST' }
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || '生成开户二维码失败');
      }
      const image = await response.blob();
      if (image.type !== 'image/png' && image.type !== 'image/jpeg') {
        throw new Error('开户二维码格式无效');
      }
      setQrCode({ imageType: image.type, imageUrl: URL.createObjectURL(image) });
      notify.success('企业开户码已生成，可供微信扫码申请开户');
      await loadCodes();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '生成开户二维码失败');
    } finally {
      setActing(false);
    }
  };

  const rotateCode = async () => {
    const accepted = await confirm({
      title: '换新企业开户码',
      description: '换新后旧码立即失效。确认已通知仍在使用旧码的申请人后再继续。',
      confirmText: '换新开户码',
      destructive: true,
    });
    if (!accepted) return;
    setActing(true);
    try {
      const response = await fetch(
        '/api/admin/enterprise-registration-codes/rotate',
        { method: 'POST' }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '换新开户码失败');
      }
      notify.success('企业开户码已换新，旧码已失效');
      await loadCodes();
      await loadQr({ confirm: false });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '换新开户码失败');
    } finally {
      setActing(false);
    }
  };

  const disableCode = async () => {
    const accepted = await confirm({
      title: '停用企业开户码',
      description: '停用后不能继续用此码申请开户；已提交的待审申请不会被修改。',
      confirmText: '停用开户码',
      destructive: true,
    });
    if (!accepted) return;
    setActing(true);
    try {
      const response = await fetch(
        '/api/admin/enterprise-registration-codes/disable',
        { method: 'POST' }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '停用开户码失败');
      }
      setQrCode(null);
      notify.success('企业开户码已停用');
      await loadCodes();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '停用开户码失败');
    } finally {
      setActing(false);
    }
  };

  const downloadQr = () => {
    if (!qrCode) return;
    const link = document.createElement('a');
    link.href = qrCode.imageUrl;
    link.download = `enterprise-registration-code.${qrCode.imageType === 'image/jpeg' ? 'jpg' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyWebRegisterLink = async () => {
    try {
      const url = `${window.location.origin}/register`;
      await navigator.clipboard.writeText(url);
      notify.success('已复制 Web 开户链接');
    } catch {
      notify.error('复制失败，请手动复制 /register');
    }
  };

  const eventColumns: ProColumns<RegistrationCodeEvent>[] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (_, item) => formatTime(item.createdAt),
    },
    { title: '动作', dataIndex: 'eventType', width: 140 },
    {
      title: '结果',
      dataIndex: 'result',
      width: 160,
      render: (_, item) => (
        <Tag color={item.result === 'active' || item.result === 'submitted' ? 'green' : 'default'}>
          {item.result}
        </Tag>
      ),
    },
    {
      title: '操作者',
      key: 'actor',
      render: (_, item) =>
        item.actorStaffId
          ? `员工 #${item.actorStaffId}`
          : item.actorUserId
            ? `用户 #${item.actorUserId}`
            : '系统/匿名扫码',
    },
  ];

  if (!canManage) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="企业开户码">
          <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以管理企业开户码。" />
        </PageContainer>
      </div>
    );
  }

  const active = isActiveCode(code);

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="企业开户码"
        content="平台级小程序扫码开户入口。与商户员工/推荐人入驻码（ej_）隔离；后台不展示令牌明文。"
        extra={(
          <Space>
            <Button icon={<Copy size={16} />} onClick={() => void copyWebRegisterLink()}>
              复制 Web 开户链接
            </Button>
            <Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void loadCodes()}>
              刷新
            </Button>
          </Space>
        )}
      >
        <Flex vertical gap={20}>
          <Alert
            showIcon
            type="info"
            message="与商户入驻码的边界"
            description={(
              <span>
                本页管理平台开户码（<code>er_</code>），用于新企业申请。员工/推荐人加入已有企业请使用商户侧{' '}
                <Link href="/join-codes">入驻码</Link>（<code>ej_</code>）。
              </span>
            )}
          />

          <Card
            loading={loading}
            title="当前开户码"
            extra={<Tag color={active ? 'green' : 'default'}>{active ? '生效中' : '未生效'}</Tag>}
          >
            <Descriptions
              size="small"
              column={2}
              items={[
                { key: 'version', label: '版本', children: code ? `v${code.version}` : '尚未创建' },
                {
                  key: 'expiry',
                  label: '失效时间',
                  children: code?.expiresAt ? formatTime(code.expiresAt) : '未设置',
                },
                { key: 'created', label: '创建时间', children: formatTime(code?.createdAt) },
                { key: 'disabled', label: '停用时间', children: formatTime(code?.disabledAt) },
              ]}
            />
            <Space wrap className="mt-4">
              {active ? (
                <Button icon={<Eye size={15} />} loading={acting} onClick={() => void loadQr()}>
                  查看二维码
                </Button>
              ) : null}
              <Button
                type="primary"
                danger={active}
                icon={<RotateCw size={15} />}
                loading={acting}
                onClick={() => void rotateCode()}
              >
                {active ? '换新' : '创建开户码'}
              </Button>
              {active ? (
                <Button
                  danger
                  icon={<ShieldOff size={15} />}
                  loading={acting}
                  onClick={() => void disableCode()}
                >
                  停用
                </Button>
              ) : null}
            </Space>
          </Card>

          <Card title="近期审计">
            <ProTable<RegistrationCodeEvent>
              rowKey="id"
              search={false}
              options={false}
              pagination={{ pageSize: 10 }}
              dataSource={events}
              columns={eventColumns}
              locale={{ emptyText: '暂无审计记录' }}
            />
          </Card>
        </Flex>

        <Drawer
          title="企业开户二维码"
          open={Boolean(qrCode)}
          onClose={() => setQrCode(null)}
          width={360}
          destroyOnClose
        >
          {qrCode ? (
            <Flex vertical gap={16} align="center">
              <Typography.Paragraph type="secondary" className="mb-0 text-center">
                90 秒后自动隐藏。请勿将图片发布到公开渠道。
              </Typography.Paragraph>
              <img
                src={qrCode.imageUrl}
                alt="企业开户二维码"
                width={240}
                height={240}
                style={{ borderRadius: 12, background: '#fff' }}
              />
              <Button icon={<Download size={15} />} onClick={downloadQr}>
                下载二维码
              </Button>
            </Flex>
          ) : null}
        </Drawer>
      </PageContainer>
    </div>
  );
}
