'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, Flex, Result, Space, Tag } from 'antd';
import { Copy, RefreshCw, RotateCw, ShieldOff } from 'lucide-react';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  MiniProgramCodeQr,
  describeMiniProgramCodeQrError,
  fetchMiniProgramCodeQr,
  revokeMiniProgramCodeQr,
  type MiniProgramCodeQrImage,
} from '@/components/admin/miniprogram-code-qr';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  getCodeAuditEventTypeLabel,
  getCodeAuditResultLabel,
  getCodeAuditResultTagColor,
} from '@/lib/code-audit-labels';

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
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [code, setCode] = useState<RegistrationCode | null>(null);
  const [events, setEvents] = useState<RegistrationCodeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<MiniProgramCodeQrImage | null>(null);
  const loadedCodeIdRef = useRef<string | null>(null);
  const inflightCodeIdRef = useRef<string | null>(null);
  const qrCodeRef = useRef<MiniProgramCodeQrImage | null>(null);
  const activeCodeIdRef = useRef<string | null>(null);
  qrCodeRef.current = qrCode;

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
    return () => revokeMiniProgramCodeQr(qrCodeRef.current);
  }, []);

  const loadQr = useCallback(async (codeId: string, options: { notifySuccess?: boolean } = {}) => {
    inflightCodeIdRef.current = codeId;
    setQrLoading(true);
    setQrError(null);
    try {
      const image = await fetchMiniProgramCodeQr('/api/admin/enterprise-registration-codes/image');
      if (activeCodeIdRef.current !== codeId) {
        revokeMiniProgramCodeQr(image);
        return;
      }
      setQrCode((current) => {
        revokeMiniProgramCodeQr(current);
        return image;
      });
      loadedCodeIdRef.current = codeId;
      if (options.notifySuccess) notify.success('已展示当前有效开户码，未换新');
    } catch (error) {
      if (activeCodeIdRef.current !== codeId) return;
      loadedCodeIdRef.current = null;
      const message = describeMiniProgramCodeQrError(error, '读取开户二维码失败');
      setQrError(message);
      if (options.notifySuccess) notify.error(message);
    } finally {
      if (inflightCodeIdRef.current === codeId) {
        inflightCodeIdRef.current = null;
        setQrLoading(false);
      }
    }
  }, []);

  const active = isActiveCode(code);

  useEffect(() => {
    if (!active || !code) {
      activeCodeIdRef.current = null;
      loadedCodeIdRef.current = null;
      inflightCodeIdRef.current = null;
      setQrLoading(false);
      setQrError(null);
      setQrCode((current) => {
        revokeMiniProgramCodeQr(current);
        return null;
      });
      return;
    }
    activeCodeIdRef.current = code.id;
    if (loadedCodeIdRef.current === code.id || inflightCodeIdRef.current === code.id) return;
    inflightCodeIdRef.current = code.id;
    void loadQr(code.id);
  }, [active, code, loadQr]);

  const rotateCode = async () => {
    const accepted = await confirm({
      title: active ? '换新企业开户码' : '创建企业开户码',
      description: active
        ? '换新后旧码立即失效。确认已通知仍在使用旧码的申请人后再继续。'
        : '将创建平台级企业开户码，供微信扫码申请开户。',
      confirmText: active ? '换新开户码' : '创建开户码',
      destructive: active,
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
      notify.success(active ? '企业开户码已换新，旧码已失效' : '企业开户码已创建');
      loadedCodeIdRef.current = null;
      await loadCodes();
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
    {
      title: '动作',
      dataIndex: 'eventType',
      width: 160,
      render: (_, item) => getCodeAuditEventTypeLabel(item.eventType),
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 180,
      render: (_, item) => (
        <Tag color={getCodeAuditResultTagColor(item.result)}>
          {getCodeAuditResultLabel(item.result)}
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

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="企业开户码"
        content="平台级小程序扫码开户入口。生效中的码可直接查看和下载；换新才会让旧码失效。与商户员工/推荐人入驻码（ej_）隔离；后台不展示令牌明文。"
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
            {active ? (
              <MiniProgramCodeQr
                alt="企业开户二维码"
                value={qrCode}
                loading={qrLoading}
                error={qrError}
                onReload={() => {
                  if (!code) return;
                  void loadQr(code.id, { notifySuccess: true });
                }}
                onDownload={downloadQr}
              />
            ) : null}
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
      </PageContainer>
    </div>
  );
}
