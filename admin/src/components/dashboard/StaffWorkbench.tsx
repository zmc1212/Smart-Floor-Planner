'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ClipboardList, ExternalLink, Map, Sparkles } from 'lucide-react';
import { Alert, Badge, Button, Card, Col, Empty, Flex, List, Row, Skeleton, Statistic, Tag } from 'antd';
import { notify } from '@/components/ui/operation-feedback';

type WorkItem = { id: string; leadId: string; floorPlanId?: string | null; title: string; subtitle: string; phone?: string | null; status: string; updatedAt?: string; timeRange?: string; canSurveyNow?: boolean; canBookAppointment?: boolean };
type Summary = { key: string; label: string; value: number; tone: string };
type StaffData = { role: 'designer' | 'measurer'; title: string; subtitle: string; summary: Summary[]; leads?: WorkItem[]; appointments?: WorkItem[]; tasks?: WorkItem[] };

export default function StaffWorkbench({ role }: { role: 'designer' | 'measurer' }) {
  const [data, setData] = useState<StaffData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/workbench/staff')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取员工工作台失败');
        setData(result.data as StaffData);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取员工工作台失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 7 }} />;
  if (!data || data.role !== role) return <Empty description="当前身份无法读取员工工作台" />;

  const items = data.role === 'designer' ? data.leads || [] : data.tasks || [];
  const surveyTasks = data.tasks || [];
  return <Flex vertical gap={20} className="dashboard-stack">
    <Row gutter={[16, 16]}>{data.summary.map((item) => <Col key={item.key} xs={12} sm={6}><Card className="admin-panel-card" size="small"><Statistic title={item.label} value={item.value} /></Card></Col>)}</Row>
    {data.role === 'measurer' ? <Alert showIcon type="info" message="正式 BLE 量房入口仍在小程序" description="后台用于查看预约和无预约待量房任务；立即量房请使用小程序正式量房编辑器。" action={<Button type="link" href="/measurements">查看量房记录</Button>} /> : null}
    {data.role === 'designer' && surveyTasks.some((item) => item.canSurveyNow) ? <Alert showIcon type="info" message="活动码获客可立即量房" description="出示活动码后，你可作为本条线索的测量员进入小程序正式量房，无需先预约。" /> : null}
    <Row gutter={[20, 20]}>
      <Col xs={24} xl={15}><Card className="admin-panel-card dashboard-workbench-card" title={data.role === 'designer' ? '本人负责客户' : '本人量房任务'} extra={<Link href={data.role === 'designer' ? '/leads' : '/measurements'}>查看全部</Link>}>
        {items.length ? <List dataSource={items} renderItem={(item) => <List.Item actions={[<Button key="open" type="link" href={`/leads/${item.leadId}`}>打开</Button>]}><List.Item.Meta title={item.title} description={<Flex gap={8} wrap>{item.subtitle}{item.timeRange ? <Tag icon={<CalendarDays size={13} />}>{item.timeRange}</Tag> : null}{item.canSurveyNow ? <Tag color="green">立即量房</Tag> : null}{item.canBookAppointment ? <Tag>可预约</Tag> : null}<Tag>{item.status}</Tag></Flex>} /></List.Item>} /> : <Empty description={data.role === 'designer' ? '暂无本人负责客户' : '暂无量房任务'} />}
      </Card></Col>
      <Col xs={24} xl={9}><Card className="admin-panel-card dashboard-workbench-card" title={data.role === 'designer' ? '设计交付入口' : '量房协作入口'}>
        <Flex vertical gap={10}>
          {data.role === 'designer' ? <>
            <Button block icon={<ClipboardList size={16} />} href="/leads">处理本人客户</Button>
            <Button block icon={<CalendarDays size={16} />} href="/leads">设置预约上门量房</Button>
            <Button block icon={<Sparkles size={16} />} href="/ai-studio/create" target="_blank">进入 AI 创作台</Button>
            <Button block icon={<Map size={16} />} href="/floorplans">查看正式户型</Button>
          </> : <>
            <Button block icon={<CalendarDays size={16} />} href="/leads">查看关联客户预约</Button>
            <Button block icon={<Map size={16} />} href="/measurements">查看量房记录</Button>
            <Button block icon={<ExternalLink size={16} />} href="/floorplans">查看已完成户型</Button>
          </>}
        </Flex>
      </Card></Col>
    </Row>
    {data.role === 'designer' && surveyTasks.length ? <Card className="admin-panel-card dashboard-workbench-card" title={<Flex gap={8} align="center"><Map size={17} />待量房任务<Badge count={surveyTasks.length} /></Flex>}><List dataSource={surveyTasks} renderItem={(item) => <List.Item><List.Item.Meta title={item.title} description={<Flex gap={8} wrap>{item.subtitle}{item.canSurveyNow ? <Tag color="green">立即量房</Tag> : null}{item.canBookAppointment ? <Tag>可预约</Tag> : null}</Flex>} /><Button type="link" href={`/leads/${item.leadId}`}>打开</Button></List.Item>} /></Card> : null}
    {data.role === 'designer' && data.appointments?.length ? <Card className="admin-panel-card dashboard-workbench-card" title={<Flex gap={8} align="center"><CalendarDays size={17} />近期预约<Badge count={data.appointments.length} /></Flex>}><List dataSource={data.appointments} renderItem={(item) => <List.Item><List.Item.Meta title={item.title} description={`${item.subtitle}${item.timeRange ? ` · ${item.timeRange}` : ''}`} /><Button type="link" href={`/leads/${item.leadId}`}>查看客户</Button></List.Item>} /></Card> : null}
  </Flex>;
}
