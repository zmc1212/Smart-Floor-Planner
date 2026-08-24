'use client';

/*
 * THESIS: Keep routing policy explainable by placing rules and their observed effect on one operating sheet.
 * OWN-WORLD: Existing Ant Design settings language with restrained comparison tables and no decorative metrics.
 * STORY: Owners set the next-version policy, then verify who qualifies and where automatic traffic actually went.
 * FIRST VIEWPORT: Claim switch and racing ratio sit beside the live distribution result.
 * FORM: Operational policy sheet; a direct extension of the approved Admin system.
 */

import { useCallback, useEffect, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Col, Flex, Form, InputNumber, Row, Space, Statistic, Switch, Tag, Typography } from 'antd';
import { ArrowLeft, Gauge, Save } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

type Settings = {
  id: string; version: number; claimEnabled: boolean; claimDurationSeconds: number;
  highPerformanceTrafficPercent: number; performanceRateThresholdPercent: number;
  performanceWindowDays: number; minimumEffectiveSamples: number; defaultDesignerCapacity: number;
  createdAt: string;
};
type Performance = { staffId: string; name: string; effectiveSamples: number; signedCount: number; signingRate: number; group: 'high' | 'standard'; openLeadCount: number; capacity: number; capacityOverride?: number | null; assignmentPaused: boolean; eligibleForAssignment: boolean };
type Distribution = { highCount: number; standardCount: number; highActualPercent: number; targetPercent: number };

export default function AssignmentSettingsPage() {
  const [form] = Form.useForm<Settings>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResponse, performanceResponse] = await Promise.all([fetch('/api/assignment-settings'), fetch('/api/assignment-performance')]);
      const [settingsResult, performanceResult] = await Promise.all([settingsResponse.json(), performanceResponse.json()]);
      if (!settingsResponse.ok || !settingsResult.success) throw new Error(settingsResult.error || '读取派单规则失败');
      if (!performanceResponse.ok || !performanceResult.success) throw new Error(performanceResult.error || '读取派单绩效失败');
      setSettings(settingsResult.data);
      form.setFieldsValue(settingsResult.data);
      setPerformance(performanceResult.data || []);
      setDistribution(performanceResult.distribution || null);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取派单设置失败');
    } finally { setLoading(false); }
  }, [form]);

  useEffect(() => { void load(); }, [load]);

  const save = async (values: Settings) => {
    setSaving(true);
    try {
      const response = await fetch('/api/assignment-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存派单设置失败');
      notify.success(`派单规则版本 v${result.data.version} 已生效`);
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存派单设置失败');
    } finally { setSaving(false); }
  };

  const columns: ProColumns<Performance>[] = [
    { title: '设计师', dataIndex: 'name' },
    { title: '有效样本', dataIndex: 'effectiveSamples', search: false, width: 100 },
    { title: '已签单', dataIndex: 'signedCount', search: false, width: 90 },
    { title: '签单率', dataIndex: 'signingRate', search: false, width: 100, render: (_, row) => `${row.signingRate}%` },
    { title: '分组', dataIndex: 'group', search: false, width: 110, render: (_, row) => <Tag color={row.group === 'high' ? 'green' : 'default'}>{row.group === 'high' ? '高绩效组' : '普通组'}</Tag> },
    { title: '在手 / 容量', search: false, width: 120, render: (_, row) => `${row.openLeadCount} / ${row.capacity}${row.capacityOverride ? '（个人）' : ''}` },
    { title: '派单资格', search: false, width: 110, render: (_, row) => <Tag color={row.eligibleForAssignment ? 'success' : 'warning'}>{row.assignmentPaused ? '已暂停' : row.eligibleForAssignment ? '可派' : '不可派'}</Tag> },
  ];

  return <div className="admin-page-frame"><PageContainer breadcrumbRender={false} className="admin-page-container" title="派单设置" content="规则保存后生成新版本，仅影响新开的抢单窗口和后续自动派单；已经开放的窗口继续使用创建时快照。" extra={<Button icon={<ArrowLeft size={16} />} href="/lead-pool">返回线索池</Button>}>
    <Flex vertical gap={20}>
      <Alert showIcon type="info" message="赛马签单率口径" description="已签单 ÷（已签单 + 正常未签单结案）。进行中、无效联系方式、重复和误录均不进入分母。" />
      <Row gutter={[20, 20]}>
        <Col xs={24} xl={16}>
          <Form<Settings> form={form} layout="vertical" disabled={loading || saving} onFinish={(values) => void save(values)}>
            <Card loading={loading} title={<Space><Gauge size={18} />抢单与赛马规则</Space>}>
              <Row gutter={[20, 0]}>
                <Col xs={24}><Form.Item name="claimEnabled" label="开启抢单" valuePropName="checked" extra="关闭后新线索立即进入赛马自动派单。"><Switch /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="claimDurationSeconds" label="抢单窗口（秒）" rules={[{ required: true }]}><InputNumber min={5} max={3600} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="highPerformanceTrafficPercent" label="高绩效组自动流量（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="performanceRateThresholdPercent" label="高绩效签单率门槛（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="minimumEffectiveSamples" label="最低有效样本（单）" rules={[{ required: true }]}><InputNumber min={1} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="performanceWindowDays" label="统计周期（天）" rules={[{ required: true }]}><InputNumber min={1} max={3650} className="w-full" /></Form.Item></Col>
                <Col xs={24} md={12}><Form.Item name="defaultDesignerCapacity" label="默认设计师在手容量" rules={[{ required: true }]} extra="员工管理可设置个人覆盖值。"><InputNumber min={1} className="w-full" /></Form.Item></Col>
              </Row>
              <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving}>保存为新版本</Button>
            </Card>
          </Form>
        </Col>
        <Col xs={24} xl={8}><Card loading={loading} title="自动派单实际分流"><Flex vertical gap={20}><Statistic title="高绩效组实际占比" value={distribution?.highActualPercent || 0} suffix="%" /><Typography.Text type="secondary">目标 {distribution?.targetPercent ?? settings?.highPerformanceTrafficPercent ?? 70}% · 高绩效组 {distribution?.highCount || 0} 单 / 普通组 {distribution?.standardCount || 0} 单</Typography.Text><Typography.Text type="secondary">仅自动派单进入分流计数；抢单和人工指派不占配额。</Typography.Text></Flex></Card></Col>
      </Row>
      <Card title="设计师绩效与容量" extra={settings ? <Typography.Text type="secondary">当前规则 v{settings.version}</Typography.Text> : null}><ProTable<Performance> rowKey="staffId" loading={loading} dataSource={performance} columns={columns} search={false} options={false} pagination={false} /></Card>
    </Flex>
  </PageContainer></div>;
}
