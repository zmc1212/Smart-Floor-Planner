'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Flex, Space, Statistic, Tag, Typography } from 'antd';
import { CheckCircle2, RefreshCw, UsersRound, Wrench } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

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
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
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
    { title: '动作', dataIndex: 'eventType', width: 140 },
    { title: '结果', dataIndex: 'result', width: 160, render: (_, item) => <Tag color={item.result === 'active' || item.result === 'joined' ? 'green' : 'default'}>{item.result}</Tag> },
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
                  <Link href="/join-codes"><Button>管理入驻码</Button></Link>
                  <Link href="/referrers"><Button>查看推荐人</Button></Link>
                  <Link href="/appointment-settings"><Button>预约设置</Button></Link>
                  <Link href="/lead-commissions"><Button>前往三方提成</Button></Link>
                  <Link href="/leads"><Button>前往线索转化</Button></Link>
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
                      <Link href={item.href}><Button size="small" type={item.ready ? 'default' : 'primary'}>{item.actionLabel}</Button></Link>
                    </Flex>
                  </Card>
                ))}
              </div>
            </section>

            <section aria-label="最近双码审计">
              <Flex justify="space-between" align="center" wrap="wrap" gap={12}>
                <Typography.Title level={4} className="!mb-0">最近双码审计</Typography.Title>
                <Link href="/join-codes"><Button>查看全部审计</Button></Link>
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
          </Flex>
        )}
      </PageContainer>
    </div>
  );
}
