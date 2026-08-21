'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, Flex, Space, Tag, Typography } from 'antd';
import { ArrowLeft, RefreshCw, RotateCw, ShieldOff } from 'lucide-react';
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

const JOIN_CODE_TYPES: JoinCodeType[] = ['staff', 'referrer'];

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
  const [qrLoadingByType, setQrLoadingByType] = useState<Partial<Record<JoinCodeType, boolean>>>({});
  const [qrByType, setQrByType] = useState<Partial<Record<JoinCodeType, MiniProgramCodeQrImage>>>({});
  const [qrErrorByType, setQrErrorByType] = useState<Partial<Record<JoinCodeType, string>>>({});
  const [globalTenantId, setGlobalTenantId] = useState('all');
  const loadedIdsRef = useRef<Partial<Record<JoinCodeType, string>>>({});
  const inflightIdsRef = useRef<Partial<Record<JoinCodeType, string>>>({});
  const qrByTypeRef = useRef(qrByType);
  qrByTypeRef.current = qrByType;

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
    return () => {
      JOIN_CODE_TYPES.forEach((type) => revokeMiniProgramCodeQr(qrByTypeRef.current[type]));
    };
  }, []);

  const codeByType = useMemo(() => {
    const result: Partial<Record<JoinCodeType, JoinCode>> = {};
    for (const code of codes) {
      if (!result[code.codeType]) result[code.codeType] = code;
    }
    return result;
  }, [codes]);

  const loadOnboardingCode = useCallback(async (
    codeType: JoinCodeType,
    codeId: string,
    options: { notifySuccess?: boolean } = {}
  ) => {
    inflightIdsRef.current[codeType] = codeId;
    setQrLoadingByType((current) => ({ ...current, [codeType]: true }));
    setQrErrorByType((current) => ({ ...current, [codeType]: undefined }));
    try {
      const image = await fetchMiniProgramCodeQr(`/api/enterprise/join-codes/${codeType}/image`);
      if (loadedIdsRef.current[codeType] !== codeId && inflightIdsRef.current[codeType] !== codeId) {
        revokeMiniProgramCodeQr(image);
        return;
      }
      setQrByType((current) => {
        revokeMiniProgramCodeQr(current[codeType]);
        return { ...current, [codeType]: image };
      });
      loadedIdsRef.current[codeType] = codeId;
      if (options.notifySuccess) {
        notify.success(`${CODE_LABELS[codeType]}当前有效二维码已展示，未换新`);
      }
    } catch (error) {
      if (inflightIdsRef.current[codeType] !== codeId && loadedIdsRef.current[codeType] !== codeId) return;
      loadedIdsRef.current[codeType] = undefined;
      const message = describeMiniProgramCodeQrError(error, '读取入驻二维码失败');
      setQrErrorByType((current) => ({ ...current, [codeType]: message }));
      if (options.notifySuccess) notify.error(message);
    } finally {
      if (inflightIdsRef.current[codeType] === codeId) {
        inflightIdsRef.current[codeType] = undefined;
        setQrLoadingByType((current) => ({ ...current, [codeType]: false }));
      }
    }
  }, []);

  useEffect(() => {
    for (const type of JOIN_CODE_TYPES) {
      const code = codeByType[type];
      if (!isActiveCode(code) || !code) {
        loadedIdsRef.current[type] = undefined;
        inflightIdsRef.current[type] = undefined;
        setQrLoadingByType((current) => (
          current[type] ? { ...current, [type]: false } : current
        ));
        setQrErrorByType((current) => (
          current[type] ? { ...current, [type]: undefined } : current
        ));
        setQrByType((current) => {
          if (!current[type]) return current;
          revokeMiniProgramCodeQr(current[type]);
          const next = { ...current };
          delete next[type];
          return next;
        });
        continue;
      }
      if (loadedIdsRef.current[type] === code.id || inflightIdsRef.current[type] === code.id) continue;
      inflightIdsRef.current[type] = code.id;
      void loadOnboardingCode(type, code.id);
    }
  }, [codeByType, loadOnboardingCode]);

  const rotateCode = async (codeType: JoinCodeType) => {
    const active = isActiveCode(codeByType[codeType]);
    const accepted = await confirm({
      title: active ? `换新${CODE_LABELS[codeType]}` : `创建${CODE_LABELS[codeType]}`,
      description: active
        ? '换新后旧码立即失效。确认已通知仍在使用旧码的人员后再继续。'
        : '将创建仅供当前企业使用的入驻码，供微信扫码入驻。',
      confirmText: active ? '换新入驻码' : '创建入驻码',
      destructive: active,
    });
    if (!accepted) return;
    setActingType(codeType);
    try {
      const response = await fetch(`/api/enterprise/join-codes/${codeType}/rotate`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '换新入驻码失败');
      notify.success(active ? `${CODE_LABELS[codeType]}已换新，旧码已失效` : `${CODE_LABELS[codeType]}已创建`);
      loadedIdsRef.current[codeType] = undefined;
      await loadCodes();
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
      notify.success(`${CODE_LABELS[codeType]}已停用`);
      await loadCodes();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '停用入驻码失败');
    } finally {
      setActingType(null);
    }
  };

  const downloadOnboardingCode = (codeType: JoinCodeType) => {
    const qr = qrByType[codeType];
    if (!qr) return;
    const link = document.createElement('a');
    link.href = qr.imageUrl;
    link.download = `${codeType}-onboarding-code.${qr.imageType === 'image/jpeg' ? 'jpg' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const eventColumns: ProColumns<JoinCodeEvent>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (_, item) => formatTime(item.createdAt) },
    { title: '码类型', dataIndex: 'codeType', width: 120, render: (_, item) => CODE_LABELS[item.codeType] },
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
    { title: '操作者', key: 'actor', render: (_, item) => item.actorStaffId ? `员工 #${item.actorStaffId}` : item.actorUserId ? `用户 #${item.actorUserId}` : '系统/匿名扫码' },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="入驻码"
        content="管理当前企业的员工入驻码和推荐人入驻码。生效中的码可直接查看和下载；换新才会让旧码失效。后台不展示令牌明文；已入驻关系不会因换码或停用而被改写。"
        extra={(
          <Space>
            <Button icon={<ArrowLeft size={16} />} href="/referrer-network-operations">返回运营工作台</Button>
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
                {JOIN_CODE_TYPES.map((type) => {
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
                        <Button type="primary" danger={active} icon={<RotateCw size={15} />} loading={actingType === type} onClick={() => void rotateCode(type)}>{active ? '换新' : '创建入驻码'}</Button>
                        {active ? <Button danger icon={<ShieldOff size={15} />} loading={actingType === type} onClick={() => void disableCode(type)}>停用</Button> : null}
                      </Space>
                      {active ? (
                        <MiniProgramCodeQr
                          alt={`${CODE_LABELS[type]}微信小程序码`}
                          value={qrByType[type] || null}
                          loading={Boolean(qrLoadingByType[type])}
                          error={qrErrorByType[type] || null}
                          onReload={() => {
                            if (!code) return;
                            void loadOnboardingCode(type, code.id, { notifySuccess: true });
                          }}
                          onDownload={() => downloadOnboardingCode(type)}
                        />
                      ) : null}
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
    </div>
  );
}
