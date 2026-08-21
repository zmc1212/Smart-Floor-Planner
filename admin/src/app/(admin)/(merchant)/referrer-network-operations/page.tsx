'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Flex, Input, Space, Statistic, Table, Tag, Typography } from 'antd';
import { CheckCircle2, RefreshCw, UsersRound, Wrench } from 'lucide-react';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  getCodeAuditEventTypeLabel,
  getCodeAuditResultLabel,
  getCodeAuditResultTagColor,
} from '@/lib/code-audit-labels';

type JoinCodeType = 'staff' | 'referrer';

type JoinCode = {
  codeType: JoinCodeType;
  status: string;
  expiresAt: string | null;
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
    timezone: string;
    defaultDurationMinutes: number;
    maxAdvanceDays: number;
  };
  commissionRules: Array<{ role: string; status: string }>;
  wechatMiniProgramCodeProviderConfigured: boolean;
};

type ResetCount = { table: string; label: string; count: number };

type ResetPreview = {
  enterpriseId: string;
  enterpriseName: string;
  mode?: 'reset' | 'purge';
  retainOperator?: boolean;
  retainedOperatorAdminUserId: string | null;
  retainedOperatorDisplayName: string | null;
  counts: ResetCount[];
  totalRows: number;
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

export default function ReferrerNetworkOperationsPage() {
  const { user } = useCurrentUser();
  const confirm = useConfirmDialog();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalTenantId, setGlobalTenantId] = useState('all');
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [purgePreview, setPurgePreview] = useState<ResetPreview | null>(null);
  const [resetPreviewLoading, setResetPreviewLoading] = useState(false);
  const [resetConfirmName, setResetConfirmName] = useState('');
  const [resetExecuting, setResetExecuting] = useState(false);
  const [purgeExecuting, setPurgeExecuting] = useState(false);

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

  const loadResetPreview = useCallback(async () => {
    if (requiresTenantSelection) return;
    setResetPreviewLoading(true);
    try {
      const [resetResponse, purgeResponse] = await Promise.all([
        fetch('/api/enterprise/enterprise-reset/preview'),
        fetch('/api/enterprise/enterprise-reset/preview?mode=purge'),
      ]);
      const resetResult = await resetResponse.json();
      const purgeResult = await purgeResponse.json();
      if (!resetResponse.ok || !resetResult.success) {
        throw new Error(resetResult.error || '预览清空范围失败');
      }
      setResetPreview(resetResult.data);
      if (purgeResponse.ok && purgeResult.success) {
        setPurgePreview(purgeResult.data);
      } else {
        setPurgePreview(null);
      }
      setResetConfirmName('');
    } catch (error) {
      setResetPreview(null);
      setPurgePreview(null);
      notify.error(error instanceof Error ? error.message : '预览清空范围失败');
    } finally {
      setResetPreviewLoading(false);
    }
  }, [requiresTenantSelection]);

  const executeEnterpriseReset = useCallback(async () => {
    if (!resetPreview) return;
    if (resetConfirmName.trim() !== resetPreview.enterpriseName) {
      notify.error('请输入与企业全名完全一致的确认文字');
      return;
    }

    const confirmed = await confirm({
      title: '确认清空当前企业测试数据？',
      destructive: true,
      confirmText: '确认清空并重跑入驻',
      cancelText: '取消',
      description: (
        <Flex vertical gap={8}>
          <Typography.Text>
            将删除本企业员工、入驻码、推荐人、预约/提成规则、线索与全部闭环数据。企业壳与你的登录账号会保留，之后需重新发码并从入驻开始。
          </Typography.Text>
          <Typography.Text type="danger">此操作不可恢复（仅删库表行，不删对象存储文件）。</Typography.Text>
        </Flex>
      ),
    });
    if (!confirmed) return;

    setResetExecuting(true);
    try {
      const response = await fetch('/api/enterprise/enterprise-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEnterpriseName: resetConfirmName.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '清空失败');
      notify.success(result.data?.retainedNote || '当前企业测试数据已清空');
      setResetConfirmName('');
      await Promise.all([loadReadiness(), loadResetPreview()]);
      const goJoinCodes = await confirm({
        title: '清空完成',
        confirmText: '去入驻码',
        cancelText: '留在本页',
        description: '可前往「入驻码」重新发放员工/推荐人入驻码，开始下一轮内测。',
      });
      if (goJoinCodes) {
        window.location.href = '/join-codes';
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '清空失败');
    } finally {
      setResetExecuting(false);
    }
  }, [confirm, loadReadiness, loadResetPreview, resetConfirmName, resetPreview]);

  const executeEnterprisePurge = useCallback(async () => {
    const target = purgePreview || resetPreview;
    if (!target) return;
    if (resetConfirmName.trim() !== target.enterpriseName) {
      notify.error('请输入与企业全名完全一致的确认文字');
      return;
    }

    const confirmed = await confirm({
      title: '确认删除整家企业（含企业壳）？',
      destructive: true,
      confirmText: '确认删除整家企业',
      cancelText: '取消',
      description: (
        <Flex vertical gap={8}>
          <Typography.Text>
            将清空本企业全部业务数据，并删除企业壳与全部员工账号（含负责人）。刷新后需重新开户/建企，不能再凭原账号登录本企业后台。
          </Typography.Text>
          <Typography.Text type="secondary">
            预览合计约 {purgePreview?.totalRows ?? target.totalRows} 行；不删对象存储文件，也不影响其他企业与全局用户表。
          </Typography.Text>
          <Typography.Text type="danger">此操作不可恢复。</Typography.Text>
        </Flex>
      ),
    });
    if (!confirmed) return;

    setPurgeExecuting(true);
    try {
      const response = await fetch('/api/enterprise/enterprise-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEnterpriseName: resetConfirmName.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除整家企业失败');

      const isMerchantOperator = user?.role === 'enterprise_admin';
      if (isMerchantOperator) {
        notify.success(result.data?.retainedNote || '整家企业已删除，请重新开户');
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.href = '/login';
        return;
      }

      notify.success(result.data?.retainedNote || '整家企业已删除');
      window.location.href = '/enterprises';
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除整家企业失败');
    } finally {
      setPurgeExecuting(false);
    }
  }, [confirm, purgePreview, resetConfirmName, resetPreview, user?.role]);

  useEffect(() => {
    const tenant = document.cookie.split('; ').find((item) => item.startsWith('global_tenant_id='));
    setGlobalTenantId(tenant?.split('=')[1] || 'all');
  }, []);

  useEffect(() => {
    if (requiresTenantSelection) {
      setLoading(false);
      setReadiness(null);
      setResetPreview(null);
      setPurgePreview(null);
      setResetPreviewLoading(false);
      return;
    }
    void loadReadiness();
    void loadResetPreview();
  }, [loadReadiness, loadResetPreview, requiresTenantSelection]);

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

  const checklist = [
    { label: '推荐人入驻准备', ready: isActiveCode(codeByType.referrer) && (readiness?.activeReferrerMemberships || 0) > 0, detail: `${readiness?.activeReferrerMemberships || 0} 个活动推荐人成员关系`, href: '/join-codes', actionLabel: '管理入驻码' },
    { label: '推广服务码前置条件', ready: (readiness?.activeReferrerPromotionCodes || 0) > 0, detail: `${readiness?.activeReferrerPromotionCodes || 0}/${readiness?.activeReferrerMemberships || 0} 个活动推荐人成员关系已有服务码`, href: '/referrers', actionLabel: '查看推荐人' },
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
        content="只展示当前企业的就绪状态和跳转入口。入驻码、推荐人通讯录和预约策略已拆到独立页面处理。"
        extra={<Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void loadReadiness()}>刷新状态</Button>}
      >
        {requiresTenantSelection ? (
          <Alert showIcon type="info" message="请先选择企业" description="平台管理员需要先在左侧导航切换到具体企业，才能查看该企业的双码、人员资格和验收准备状态。" />
        ) : (
          <Flex vertical gap={20}>
            <Alert showIcon type="info" message="工作台只显示已发生的业务事实" description="不会创建测试客户、线索、预约、量房、AI 方案或签单；人工验收仍须使用真实小程序账号完成手机号授权和客户所有权校验。" />

            <section aria-label="运营摘要">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card loading={loading}><Statistic title="活动推荐人" value={readiness?.activeReferrerMemberships || 0} prefix={<UsersRound size={18} />} /></Card>
                <Card loading={loading}><Statistic title="可出示推广码" value={readiness?.activeReferrerPromotionCodes || 0} suffix={`/ ${readiness?.activeReferrerMemberships || 0}`} /></Card>
                <Card loading={loading}><Statistic title="可派单设计师" value={eligibility.eligibleDesigners.length} prefix={<UsersRound size={18} />} suffix={`/ ${eligibility.designers.length}`} /></Card>
                <Card loading={loading}><Statistic title="可派单测量员" value={eligibility.eligibleMeasurers.length} prefix={<Wrench size={18} />} suffix={`/ ${eligibility.measurers.length}`} /></Card>
              </div>
            </section>

            <section aria-label="验收准备清单">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                <Typography.Title level={4} className="!mb-0">全流程验收准备清单</Typography.Title>
                <Space wrap>
                  <Button href="/join-codes">管理入驻码</Button>
                  <Button href="/referrers">查看推荐人</Button>
                  <Button href="/appointment-settings">预约设置</Button>
                  <Button href="/lead-commissions">前往三方提成</Button>
                  <Button href="/leads">前往线索转化</Button>
                </Space>
              </Flex>
              <div className="grid gap-3 py-4 lg:grid-cols-2">
                {checklist.map((item) => (
                  <Card key={item.label} size="small">
                    <Flex align="center" gap={12} wrap="wrap">
                      <CheckCircle2 size={20} className={item.ready ? 'text-green-600' : 'text-slate-400'} />
                      <Flex vertical gap={1} className="min-w-0 flex-1">
                        <Typography.Text strong>{item.label}</Typography.Text>
                        <Typography.Text type="secondary">{item.detail}</Typography.Text>
                      </Flex>
                      <Tag color={item.ready ? 'green' : 'orange'}>{item.ready ? '已就绪' : '待处理'}</Tag>
                      <Button size="small" type={item.ready ? 'default' : 'primary'} href={item.href}>{item.actionLabel}</Button>
                    </Flex>
                  </Card>
                ))}
              </div>
            </section>

            <section aria-label="最近双码审计">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                <Typography.Title level={4} className="!mb-0">最近双码审计</Typography.Title>
                <Button href="/join-codes">查看全部审计</Button>
              </Flex>
              <ProTable<JoinCodeEvent>
                rowKey="id"
                loading={loading}
                dataSource={(readiness?.events || []).slice(0, 5)}
                columns={eventColumns}
                search={false}
                options={false}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </section>

            <section aria-label="测试企业清空">
              <Card
                loading={resetPreviewLoading}
                title="清空当前企业测试数据"
                extra={
                  <Button size="small" icon={<RefreshCw size={14} />} onClick={() => void loadResetPreview()}>
                    刷新预览
                  </Button>
                }
              >
                <Flex vertical gap={16}>
                  <Alert
                    showIcon
                    type="warning"
                    message="内测专用：两档危险操作"
                    description="「清空并重跑入驻」保留企业壳与当前操作者账号，需重新发码入驻。「删除整家企业」会连同企业壳与全部员工账号（含负责人）一并删除，刷新后需重新开户/建企。均不删对象存储文件，也不影响其他企业。"
                  />
                  {resetPreview ? (
                    <>
                      <Typography.Paragraph className="!mb-0">
                        企业：<Typography.Text strong>{resetPreview.enterpriseName}</Typography.Text>
                        {' · '}
                        重跑预览约 {resetPreview.totalRows} 行
                        {purgePreview ? ` · 整企删除预览约 ${purgePreview.totalRows} 行` : ''}
                        {resetPreview.retainedOperatorDisplayName
                          ? ` · 重跑将保留操作者：${resetPreview.retainedOperatorDisplayName}`
                          : ' · 重跑时当前企业未匹配到可保留的操作者员工账号'}
                      </Typography.Paragraph>
                      <Table
                        size="small"
                        rowKey="table"
                        pagination={false}
                        dataSource={resetPreview.counts.filter((item) => item.count > 0)}
                        columns={[
                          { title: '类别（重跑入驻预览）', dataIndex: 'label' },
                          { title: '行数', dataIndex: 'count', width: 96 },
                        ]}
                        locale={{ emptyText: '当前企业几乎没有可清业务数据' }}
                      />
                      <Flex vertical gap={8}>
                        <Typography.Text>
                          请输入企业全名 <Typography.Text code>{resetPreview.enterpriseName}</Typography.Text> 以确认
                        </Typography.Text>
                        <Input
                          value={resetConfirmName}
                          placeholder="输入企业全名"
                          onChange={(event) => setResetConfirmName(event.target.value)}
                          disabled={resetExecuting || purgeExecuting}
                        />
                        <Space wrap>
                          <Button
                            danger
                            type="primary"
                            loading={resetExecuting}
                            disabled={
                              purgeExecuting || resetConfirmName.trim() !== resetPreview.enterpriseName
                            }
                            onClick={() => void executeEnterpriseReset()}
                          >
                            清空并重跑入驻
                          </Button>
                          <Button
                            danger
                            loading={purgeExecuting}
                            disabled={
                              resetExecuting || resetConfirmName.trim() !== resetPreview.enterpriseName
                            }
                            onClick={() => void executeEnterprisePurge()}
                          >
                            删除整家企业（含企业壳）
                          </Button>
                          <Button href="/join-codes">清空后去入驻码</Button>
                        </Space>
                      </Flex>
                    </>
                  ) : (
                    <Typography.Text type="secondary">暂无预览；若环境闸门拒绝，请检查非生产环境或 ALLOW_TENANT_ENTERPRISE_RESET。</Typography.Text>
                  )}
                </Flex>
              </Card>
            </section>
          </Flex>
        )}
      </PageContainer>
    </div>
  );
}
