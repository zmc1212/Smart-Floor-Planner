'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, ClipboardList, Map, Users } from 'lucide-react';
import { Badge, Button, Card, Col, Empty, Flex, List, Row, Skeleton, Statistic, Tag, Typography } from 'antd';
import { notify } from '@/components/ui/operation-feedback';
import OverviewStatCard from '@/components/dashboard/OverviewStatCard';

interface MerchantAdmin { displayName: string; username: string; role: string; enterpriseName: string | null; }
type ApiResponse<T> = { success?: boolean; data?: T; pagination?: { total?: number }; error?: string };
type WorkbenchCard = { key: string; label: string; value: number };
type Todo = { key: string; title: string; enterpriseName?: string; contactPerson?: string; overdue?: boolean };
type Lead = { _id: string; name?: string; phone?: string; stylePreference?: string; createdAt?: string };
type DashboardState = { leadCount: number; planCount: number; staffCount: number; latestLeads: Lead[]; automationCards: WorkbenchCard[]; latestTodos: Todo[]; overdueTodos: Todo[] };
type WorkbenchSummary = { cards?: WorkbenchCard[]; latestTodos?: Todo[] };

const emptyStats: DashboardState = { leadCount: 0, planCount: 0, staffCount: 0, latestLeads: [], automationCards: [], latestTodos: [], overdueTodos: [] };

export default function MerchantDashboard({ admin }: { admin: MerchantAdmin }) {
  const [stats, setStats] = useState<DashboardState>(emptyStats);
  const [loading, setLoading] = useState(true);
  const canViewEnterpriseAssets = admin.role === 'enterprise_admin';

  useEffect(() => {
    const fetchMerchantStats = async () => {
      try {
        const requests = [fetch('/api/workbench/summary'), fetch('/api/workbench/todos?view=overdue')];
        if (canViewEnterpriseAssets) requests.push(fetch('/api/leads'), fetch('/api/floorplans'), fetch('/api/staff'));
        const responses = await Promise.all(requests);
        const results = await Promise.all(responses.map((response) => response.json()));
        const [summaryResponse, overdueResponse] = responses;
        const [summaryData, overdueData] = results as [ApiResponse<WorkbenchSummary>, ApiResponse<Todo[]>, ...ApiResponse<unknown>[]];

        if (!summaryResponse.ok || !overdueResponse.ok || !summaryData.success || !overdueData.success) {
          throw new Error(summaryData.error || overdueData.error || '读取工作台数据失败');
        }

        const nextStats: DashboardState = { ...emptyStats, automationCards: summaryData.data?.cards || [], latestTodos: summaryData.data?.latestTodos || [], overdueTodos: overdueData.data || [] };

        if (canViewEnterpriseAssets) {
          const [leadsResponse, floorPlansResponse, staffResponse] = responses.slice(2);
          const [leadsData, floorPlansData, staffData] = results.slice(2) as [ApiResponse<Lead[]>, ApiResponse<unknown[]>, ApiResponse<unknown[]>];
          if (!leadsResponse.ok || !floorPlansResponse.ok || !staffResponse.ok || !leadsData.success || !floorPlansData.success || !staffData.success) {
            throw new Error(leadsData.error || floorPlansData.error || staffData.error || '读取企业资产失败');
          }
          nextStats.leadCount = leadsData.pagination?.total || 0;
          nextStats.planCount = floorPlansData.pagination?.total || 0;
          nextStats.staffCount = staffData.pagination?.total || 0;
          nextStats.latestLeads = leadsData.data?.slice(0, 3) || [];
        }
        setStats(nextStats);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : '读取工作台数据失败');
      } finally { setLoading(false); }
    };
    void fetchMerchantStats();
  }, [canViewEnterpriseAssets]);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;

  return (
    <Flex vertical gap={24} className="dashboard-stack">
      {canViewEnterpriseAssets ? <Row gutter={[16, 16]}>
        <OverviewStatCard title="跟进线索" value={stats.leadCount} icon={<ClipboardList size={18} />} />
        <OverviewStatCard title="正式户型" value={stats.planCount} icon={<Map size={18} />} />
        <OverviewStatCard title="团队成员" value={stats.staffCount} icon={<Users size={18} />} />
      </Row> : null}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={15}><Flex vertical gap={16}>
          <Card className="admin-panel-card dashboard-workbench-card" size="small" title="协作待办" extra={<DashboardLink href="/promotion-records" label="前往处理" />}>
            <Row gutter={[12, 12]}>{stats.automationCards.map((card) => <Col key={card.key} xs={12} sm={6}><div className="dashboard-mini-stat"><Statistic title={card.label} value={card.value} /></div></Col>)}</Row>
          </Card>
          <Card className="admin-panel-card dashboard-workbench-card" size="small" title="最近待办" extra={<Badge count={stats.latestTodos.length} showZero />}><TodoList todos={stats.latestTodos} /></Card>
        </Flex></Col>
        <Col xs={24} xl={9}><Card className="admin-panel-card dashboard-workbench-card dashboard-alert-panel h-full" size="small" title={<Flex align="center" gap={8}><AlertTriangle size={18} className="text-amber-500" />超时提醒</Flex>} extra={<Badge count={stats.overdueTodos.length} showZero />}><TodoList todos={stats.overdueTodos.slice(0, 4)} overdue /></Card></Col>
      </Row>
      {canViewEnterpriseAssets ? <Card className="admin-panel-card dashboard-workbench-card" size="small" title="最近线索流转" extra={<DashboardLink href="/leads" label="查看全部" />}>
        {stats.latestLeads.length > 0 ? <List dataSource={stats.latestLeads} renderItem={(lead) => <List.Item><Flex justify="space-between" align="center" gap={16} className="w-full"><Flex vertical gap={2}><Typography.Text strong>{lead.name || '未命名客户'}</Typography.Text><Typography.Text type="secondary">{lead.phone || '-'}</Typography.Text></Flex><Flex align="center" gap={12}><Typography.Text type="secondary" className="hidden sm:block">{lead.stylePreference || '未设置风格偏好'}</Typography.Text><Tag>{formatDate(lead.createdAt)}</Tag></Flex></Flex></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无最新线索" />}
      </Card> : null}
    </Flex>
  );
}

function TodoList({ todos, overdue = false }: { todos: Todo[]; overdue?: boolean }) {
  if (todos.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={overdue ? '当前没有超时事项' : '当前没有新的协作待办'} />;
  return <List dataSource={todos} renderItem={(todo) => <List.Item><Link href="/promotion-records" className="block w-full"><Flex justify="space-between" align="center" gap={16}><Flex vertical gap={2}><Typography.Text strong>{todo.title}</Typography.Text><Typography.Text type="secondary">{[todo.enterpriseName, todo.contactPerson].filter(Boolean).join(' / ') || '-'}</Typography.Text></Flex><Tag color={todo.overdue ? 'error' : 'default'}>{todo.overdue ? '已超时' : '处理中'}</Tag></Flex></Link></List.Item>} />;
}

function DashboardLink({ href, label }: { href: string; label: string }) { return <Link href={href}><Button type="link" size="small" icon={<ArrowRight size={15} />}>{label}</Button></Link>; }
function formatDate(value?: string) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN'); }
