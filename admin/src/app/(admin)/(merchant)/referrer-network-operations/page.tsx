'use client';
/* eslint-disable @next/next/no-img-element -- QR codes are transient authenticated Blob URLs. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Descriptions, Drawer, Flex, Space, Statistic, Tag, Typography } from 'antd';
import { CheckCircle2, Download, Eye, RefreshCw, RotateCw, ShieldOff, UsersRound, Wrench } from 'lucide-react';
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

type StaffMember = {
  _id: string;
  username: string;
  displayName: string;
  role: 'designer' | 'measurer';
  status: string;
  assignmentPaused: boolean;
  wechatId: string | null;
  wechatQrAssetId: string | null;
};

type Readiness = {
  codes: JoinCode[];
  events: JoinCodeEvent[];
  activeReferrerMemberships: number;
  activeReferrerPromotionCodes: number;
  activeStaffActivityCodes: number;
  staff: StaffMember[];
  appointmentSettings: {
    configured: boolean;
    configuredAt: string | null;
    timezone: string;
    defaultDurationMinutes: number;
    slotStepMinutes: number;
    maxAdvanceDays: number;
    customerRescheduleCutoffHours: number;
  };
  commissionRules: Array<{ role: string; status: string; calculationType: string; value: string }>;
  wechatMiniProgramCodeProviderConfigured: boolean;
};

const CODE_LABELS: Record<JoinCodeType, string> = {
  staff: '员工入驻码',
  referrer: '推荐人入驻码',
};

const ROLE_LABELS: Record<StaffMember['role'], string> = {
  designer: '设计师',
  measurer: '测量员',
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

export default function ReferrerNetworkOperationsPage() {
  const confirm = useConfirmDialog();
  const { user } = useCurrentUser();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
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

  const loadReadiness = useCallback(async () => {
    if (requiresTenantSelection) return;
    setLoading(true);
    try {
      const response = await fetch('/api/enterprise/referrer-network-readiness');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取推荐网络运营状态失败');
      setReadiness(result.data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取推荐网络运营状态失败');
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
      setReadiness(null);
      return;
    }
    void loadReadiness();
  }, [loadReadiness, requiresTenantSelection]);

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
    for (const code of readiness?.codes || []) {
      if (!result[code.codeType]) result[code.codeType] = code;
    }
    return result;
  }, [readiness?.codes]);

  const eligibility = useMemo(() => {
    const staff = readiness?.staff || [];
    const designers = staff.filter((member) => member.role === 'designer');
    const measurers = staff.filter((member) => member.role === 'measurer');
    return {
      designers,
      measurers,
      eligibleDesigners: designers.filter((member) => member.status === 'active' && !member.assignmentPaused && Boolean(member.wechatId && member.wechatQrAssetId)),
      eligibleMeasurers: measurers.filter((member) => member.status === 'active' && !member.assignmentPaused),
    };
  }, [readiness?.staff]);

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
      await loadReadiness();
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
      await loadReadiness();
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
      await loadReadiness();
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

  const staffColumns: ProColumns<StaffMember>[] = [
    { title: '员工', key: 'staff', render: (_, item) => <Flex vertical gap={0}><Typography.Text strong>{item.displayName || item.username}</Typography.Text><Typography.Text type="secondary" className="text-xs">@{item.username}</Typography.Text></Flex> },
    { title: '岗位', dataIndex: 'role', width: 100, render: (_, item) => <Tag color={item.role === 'designer' ? 'blue' : 'gold'}>{ROLE_LABELS[item.role]}</Tag> },
    { title: '账号', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '启用' : value}</Tag> },
    { title: '派单', key: 'assignment', width: 110, render: (_, item) => <Tag color={item.status === 'active' && !item.assignmentPaused ? 'green' : 'default'}>{item.assignmentPaused ? '已暂停' : item.status === 'active' ? '可参与' : '账号未启用'}</Tag> },
    { title: '设计师资料', key: 'designerProfile', render: (_, item) => item.role === 'designer' ? <Tag color={item.wechatId && item.wechatQrAssetId ? 'green' : 'orange'}>{item.wechatId && item.wechatQrAssetId ? '微信号及二维码完整' : '缺少微信号或二维码'}</Tag> : '不适用' },
    { title: '最终资格', key: 'eligible', width: 110, render: (_, item) => {
      const eligible = item.status === 'active' && !item.assignmentPaused && (item.role === 'measurer' || Boolean(item.wechatId && item.wechatQrAssetId));
      return <Tag color={eligible ? 'green' : 'red'}>{eligible ? '可自动派单' : '暂不可派单'}</Tag>;
    } },
  ];

  const eventColumns: ProColumns<JoinCodeEvent>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (_, item) => formatTime(item.createdAt) },
    { title: '码类型', dataIndex: 'codeType', width: 120, render: (_, item) => CODE_LABELS[item.codeType] },
    { title: '动作', dataIndex: 'eventType', width: 140 },
    { title: '结果', dataIndex: 'result', width: 160, render: (_, item) => <Tag color={item.result === 'active' || item.result === 'joined' ? 'green' : 'default'}>{item.result}</Tag> },
    { title: '操作者', key: 'actor', render: (_, item) => item.actorStaffId ? `员工 #${item.actorStaffId}` : item.actorUserId ? `用户 #${item.actorUserId}` : '系统/匿名扫码' },
  ];

  const checklist = [
    { label: '推荐人入驻准备', ready: isActiveCode(codeByType.referrer) && (readiness?.activeReferrerMemberships || 0) > 0, detail: `${readiness?.activeReferrerMemberships || 0} 个活动推荐人成员关系`, href: '#enterprise-join-codes', actionLabel: '管理入驻码' },
    { label: '推广服务码前置条件', ready: (readiness?.activeReferrerPromotionCodes || 0) > 0, detail: `${readiness?.activeReferrerPromotionCodes || 0}/${readiness?.activeReferrerMemberships || 0} 个活动推荐人成员关系已有服务码`, href: '#enterprise-join-codes', actionLabel: '查看双码' },
    { label: '可派活动码的设计师/测量员', ready: eligibility.eligibleDesigners.length + eligibility.eligibleMeasurers.length > 0, detail: `${readiness?.activeStaffActivityCodes || 0} 份活动码 · ${eligibility.eligibleDesigners.length + eligibility.eligibleMeasurers.length} 人可出示（设计师须微信号和二维码完整）`, href: '/staff', actionLabel: '管理员工' },
    { label: '可派单设计师', ready: eligibility.eligibleDesigners.length > 0, detail: `${eligibility.eligibleDesigners.length}/${eligibility.designers.length} 人资料完整且未暂停`, href: '/staff', actionLabel: '管理员工' },
    { label: '可派单测量员', ready: eligibility.eligibleMeasurers.length > 0, detail: `${eligibility.eligibleMeasurers.length}/${eligibility.measurers.length} 人启用且未暂停`, href: '/staff', actionLabel: '管理员工' },
    { label: '预约设置', ready: Boolean(readiness?.appointmentSettings.configured), detail: readiness?.appointmentSettings ? `${readiness.appointmentSettings.timezone} · ${readiness.appointmentSettings.defaultDurationMinutes} 分钟/次 · ${readiness.appointmentSettings.maxAdvanceDays} 天内${readiness.appointmentSettings.configured ? '' : '（默认值待确认）'}` : '尚未读取', href: '/appointment-settings', actionLabel: '配置预约' },
    { label: '三方提成规则', ready: (readiness?.commissionRules.filter((rule) => rule.status === 'active').length || 0) === 3, detail: `${readiness?.commissionRules.filter((rule) => rule.status === 'active').length || 0}/3 条规则生效`, href: '/lead-commissions', actionLabel: '配置提成' },
    { label: '微信小程序服务码能力', ready: Boolean(readiness?.wechatMiniProgramCodeProviderConfigured), detail: readiness?.wechatMiniProgramCodeProviderConfigured ? '小程序码服务端凭据已可用' : '缺少小程序码服务端凭据', href: '/workflow-logs', actionLabel: '查看送达记录' },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="推荐网络运营与验收"
        content="在当前企业边界内管理双码、核对自动派单资格，并用真实状态准备推荐人—客户—量房—方案—签单闭环验收。"
        extra={<Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void loadReadiness()}>刷新状态</Button>}
      >
        {requiresTenantSelection ? (
          <Alert showIcon type="info" message="请先选择企业" description="平台管理员需要先在左侧导航切换到具体企业，才能查看该企业的双码、人员资格和验收准备状态。" />
        ) : (
          <Flex vertical gap={20}>
            <Alert showIcon type="info" message="工作台只显示已发生的业务事实" description="不会创建测试客户、线索、预约、量房、AI 方案或签单；人工验收仍须使用真实小程序账号完成手机号授权和客户所有权校验。" />

            <section id="enterprise-join-codes" aria-label="入驻码管理">
              <Typography.Title level={4}>企业双码</Typography.Title>
              <div className="grid gap-4 lg:grid-cols-2">
                {(['staff', 'referrer'] as JoinCodeType[]).map((type) => {
                  const code = codeByType[type];
                  const active = isActiveCode(code);
                  return <Card key={type} loading={loading} title={CODE_LABELS[type]} extra={<Tag color={active ? 'green' : 'default'}>{active ? '生效中' : '未生效'}</Tag>}>
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
                  </Card>;
                })}
              </div>
            </section>

            <section aria-label="派单资格">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}><Typography.Title level={4} className="!mb-0">自动派单资格</Typography.Title><Link href="/staff"><Button>前往员工管理</Button></Link></Flex>
              <div className="grid gap-4 py-4 md:grid-cols-2"><Card><Statistic title="可派单设计师" value={eligibility.eligibleDesigners.length} prefix={<UsersRound size={18} />} suffix={`/ ${eligibility.designers.length}`} /></Card><Card><Statistic title="可派单测量员" value={eligibility.eligibleMeasurers.length} prefix={<Wrench size={18} />} suffix={`/ ${eligibility.measurers.length}`} /></Card></div>
              <ProTable<StaffMember> rowKey="_id" loading={loading} dataSource={readiness?.staff || []} columns={staffColumns} search={false} options={false} pagination={false} scroll={{ x: 900 }} />
            </section>

            <section aria-label="验收准备清单">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}><Typography.Title level={4} className="!mb-0">全流程验收准备清单</Typography.Title><Space wrap><Link href="/lead-commissions"><Button>前往三方提成</Button></Link><Link href="/leads"><Button>前往线索转化</Button></Link></Space></Flex>
              <div className="grid gap-3 py-4 lg:grid-cols-2">
                {checklist.map((item) => <Card key={item.label} size="small"><Flex align="center" gap={12} wrap="wrap"><CheckCircle2 size={20} className={item.ready ? 'text-green-600' : 'text-slate-400'} /><Flex vertical gap={1} className="min-w-0 flex-1"><Typography.Text strong>{item.label}</Typography.Text><Typography.Text type="secondary">{item.detail}</Typography.Text></Flex><Tag color={item.ready ? 'green' : 'orange'}>{item.ready ? '已就绪' : '待处理'}</Tag><Link href={item.href}><Button size="small" type={item.ready ? 'default' : 'primary'}>{item.actionLabel}</Button></Link></Flex></Card>)}
              </div>
            </section>

            <section aria-label="双码审计"><Typography.Title level={4}>双码审计</Typography.Title><ProTable<JoinCodeEvent> rowKey="id" loading={loading} dataSource={readiness?.events || []} columns={eventColumns} search={false} options={false} pagination={{ defaultPageSize: 10, showSizeChanger: true }} scroll={{ x: 760 }} /></section>
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
