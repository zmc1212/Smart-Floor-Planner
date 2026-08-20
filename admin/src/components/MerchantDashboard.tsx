'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClipboardList, Map, Users } from 'lucide-react';
import { Button, Card, Empty, Flex, List, Row, Skeleton, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import OverviewStatCard from '@/components/dashboard/OverviewStatCard';
import OpsDashboardPanel from '@/components/dashboard/OpsDashboardPanel';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface MerchantAdmin { displayName: string; username: string; role: string; enterpriseName: string | null; }
type ApiResponse<T> = { success?: boolean; data?: T; pagination?: { total?: number }; error?: string };
type Lead = { _id: string; name?: string; phone?: string; stylePreference?: string; createdAt?: string };
type DashboardState = { leadCount: number; planCount: number; staffCount: number; latestLeads: Lead[] };

const emptyStats: DashboardState = { leadCount: 0, planCount: 0, staffCount: 0, latestLeads: [] };

export default function MerchantDashboard({ admin }: { admin: MerchantAdmin }) {
  const router = useRouter();
  const { user, isLoading: loadingUser } = useCurrentUser();
  const [stats, setStats] = useState<DashboardState>(emptyStats);
  const [loading, setLoading] = useState(true);

  const permissions = user?.effectivePermissions || [];
  const canViewLeads = permissions.includes('leads');
  const canViewFloorplans = permissions.includes('floorplans');
  const canViewStaff = permissions.includes('staff');
  const isEnterpriseOwner = admin.role === 'enterprise_admin';
  const canViewEnterpriseAssets = isEnterpriseOwner && (canViewLeads || canViewFloorplans || canViewStaff);

  useEffect(() => {
    if (loadingUser) return;

    const fetchMerchantStats = async () => {
      try {
        const requests: Array<{ key: string; promise: Promise<Response> }> = [];
        if (isEnterpriseOwner && canViewLeads) requests.push({ key: 'leads', promise: fetch('/api/leads') });
        if (isEnterpriseOwner && canViewFloorplans) requests.push({ key: 'floorplans', promise: fetch('/api/floorplans') });
        if (isEnterpriseOwner && canViewStaff) requests.push({ key: 'staff', promise: fetch('/api/staff') });

        if (requests.length === 0) {
          setStats(emptyStats);
          return;
        }

        const responses = await Promise.all(requests.map((request) => request.promise));
        const results = await Promise.all(responses.map((response) => response.json()));
        const byKey = Object.fromEntries(
          requests.map((request, index) => [request.key, { response: responses[index], data: results[index] as ApiResponse<unknown> }])
        );

        const nextStats: DashboardState = { ...emptyStats };

        if (byKey.leads) {
          const leads = byKey.leads as { response: Response; data: ApiResponse<Lead[]> };
          if (!leads.response.ok || !leads.data.success) {
            throw new Error(leads.data.error || '读取线索失败');
          }
          nextStats.leadCount = leads.data.pagination?.total || 0;
          nextStats.latestLeads = leads.data.data?.slice(0, 3) || [];
        }
        if (byKey.floorplans) {
          const floorPlans = byKey.floorplans as { response: Response; data: ApiResponse<unknown[]> };
          if (!floorPlans.response.ok || !floorPlans.data.success) {
            throw new Error(floorPlans.data.error || '读取户型失败');
          }
          nextStats.planCount = floorPlans.data.pagination?.total || 0;
        }
        if (byKey.staff) {
          const staff = byKey.staff as { response: Response; data: ApiResponse<unknown[]> };
          if (!staff.response.ok || !staff.data.success) {
            throw new Error(staff.data.error || '读取团队失败');
          }
          nextStats.staffCount = staff.data.pagination?.total || 0;
        }

        setStats(nextStats);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : '读取工作台数据失败');
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    void fetchMerchantStats();
  }, [loadingUser, isEnterpriseOwner, canViewLeads, canViewFloorplans, canViewStaff]);

  if (loading || loadingUser) return <Skeleton active paragraph={{ rows: 6 }} />;

  return (
    <Flex vertical gap={24} className="dashboard-stack">
      {canViewEnterpriseAssets ? <Row gutter={[16, 16]}>
        {canViewLeads ? <OverviewStatCard title="跟进线索" value={stats.leadCount} icon={<ClipboardList size={18} />} /> : null}
        {canViewFloorplans ? <OverviewStatCard title="正式户型" value={stats.planCount} icon={<Map size={18} />} /> : null}
        {canViewStaff ? <OverviewStatCard title="团队成员" value={stats.staffCount} icon={<Users size={18} />} /> : null}
      </Row> : null}
      {isEnterpriseOwner ? <OpsDashboardPanel /> : null}
      {canViewLeads ? <Card className="admin-panel-card dashboard-workbench-card" size="small" title="最近线索流转" extra={<DashboardLink href="/leads" label="查看全部" onNavigate={(href) => router.push(href)} />}>
        {stats.latestLeads.length > 0 ? <List dataSource={stats.latestLeads} renderItem={(lead) => <List.Item><Flex justify="space-between" align="center" gap={16} className="w-full"><Flex vertical gap={2}><Typography.Text strong>{lead.name || '未命名客户'}</Typography.Text><Typography.Text type="secondary">{lead.phone || '-'}</Typography.Text></Flex><Flex align="center" gap={12}><Typography.Text type="secondary" className="hidden sm:block">{lead.stylePreference || '未设置风格偏好'}</Typography.Text><Tag>{formatDate(lead.createdAt)}</Tag></Flex></Flex></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无最新线索" />}
      </Card> : null}
    </Flex>
  );
}

function DashboardLink({ href, label, onNavigate }: { href: string; label: string; onNavigate: (href: string) => void }) {
  return <Button type="link" size="small" icon={<ArrowRight size={15} />} onClick={() => onNavigate(href)}>{label}</Button>;
}
function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('zh-CN');
}
