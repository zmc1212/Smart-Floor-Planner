'use client';

/*
 * THESIS: Turn enterprise scheduling policy into one calm, auditable operating sheet.
 * OWN-WORLD: Existing Admin Pro workbench, Ant Design controls, and shared feedback system.
 * STORY: Confirm the policy state, set weekly availability, then tune booking boundaries.
 * FIRST VIEWPORT: Status, timezone, and the start of the weekly schedule stay visible.
 * FORM: Operational settings sheet; no decorative dashboard cards or invented imagery.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Col, Flex, Form, Input, InputNumber, Row, Select, Space, Switch, Typography } from 'antd';
import { ArrowLeft, CalendarClock, Plus, Save, Trash2 } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';

type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type DaySetting = { enabled: boolean; windows: Array<{ start: string; end: string }> };
type AppointmentSettings = {
  timezone: string;
  weeklySchedule: Record<string, Array<{ start: string; end: string }>>;
  defaultDurationMinutes: number;
  slotStepMinutes: number;
  maxAdvanceDays: number;
  customerRescheduleCutoffHours: number;
  configured: boolean;
  configuredAt: string | null;
};

type SettingsForm = Omit<AppointmentSettings, 'configured' | 'configuredAt' | 'weeklySchedule'> & {
  weeklySchedule: Record<DayKey, DaySetting>;
};

const DAYS: Array<{ key: DayKey; scheduleKey: string; label: string }> = [
  { key: 'monday', scheduleKey: '1', label: '周一' },
  { key: 'tuesday', scheduleKey: '2', label: '周二' },
  { key: 'wednesday', scheduleKey: '3', label: '周三' },
  { key: 'thursday', scheduleKey: '4', label: '周四' },
  { key: 'friday', scheduleKey: '5', label: '周五' },
  { key: 'saturday', scheduleKey: '6', label: '周六' },
  { key: 'sunday', scheduleKey: '0', label: '周日' },
];

const DEFAULT_DAY: DaySetting = { enabled: false, windows: [{ start: '09:00', end: '18:00' }] };

function normalizeForm(settings: AppointmentSettings): SettingsForm {
  return {
    timezone: settings.timezone,
    weeklySchedule: Object.fromEntries(
      DAYS.map(({ key, scheduleKey }) => {
        const windows = settings.weeklySchedule?.[scheduleKey] || [];
        return [key, { enabled: windows.length > 0, windows: windows.length ? windows : DEFAULT_DAY.windows }];
      })
    ) as Record<DayKey, DaySetting>,
    defaultDurationMinutes: settings.defaultDurationMinutes,
    slotStepMinutes: settings.slotStepMinutes,
    maxAdvanceDays: settings.maxAdvanceDays,
    customerRescheduleCutoffHours: settings.customerRescheduleCutoffHours,
  };
}

function formatTime(value: string | null) {
  if (!value) return '尚未确认';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '尚未确认' : date.toLocaleString('zh-CN', { hour12: false });
}

function validateWeeklySchedule(values: SettingsForm) {
  for (const { key, label } of DAYS) {
    const day = values.weeklySchedule[key];
    if (!day.enabled) continue;
    if (!day.windows?.length) return `${label}已开放，请至少保留一个时段`;
    const windows = [...day.windows].sort((left, right) => left.start.localeCompare(right.start));
    if (windows.some((window) => !window.start || !window.end || window.start >= window.end)) {
      return `${label}存在无效的开始或结束时间`;
    }
    if (windows.some((window, index) => index > 0 && window.start < windows[index - 1].end)) {
      return `${label}的多个时段不能重叠`;
    }
  }
  return '';
}

export default function AppointmentSettingsPage() {
  const [form] = Form.useForm<SettingsForm>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AppointmentSettings | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/appointment-settings');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取预约设置失败');
      setSettings(result.data);
      form.setFieldsValue(normalizeForm(result.data));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取预约设置失败');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async (values: SettingsForm) => {
    const scheduleError = validateWeeklySchedule(values);
    if (scheduleError) {
      notify.error(scheduleError);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/appointment-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          weeklySchedule: Object.fromEntries(DAYS.map(({ key, scheduleKey }) => {
            const day = values.weeklySchedule[key];
            return [scheduleKey, day.enabled ? day.windows : []];
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存预约设置失败');
      setSettings(result.data);
      form.setFieldsValue(normalizeForm(result.data));
      notify.success('预约设置已保存并确认');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存预约设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="预约设置"
        content="配置当前企业的可预约时段、量房时长和客户改期边界；保存后验收工作台才会将本项标记为已就绪。"
        extra={<Link href="/referrer-network-operations"><Button icon={<ArrowLeft size={16} />}>返回验收工作台</Button></Link>}
      >
        <Flex vertical gap={20}>
          <Alert
            showIcon
            type={settings?.configured ? 'success' : 'warning'}
            message={settings?.configured ? '当前预约规则已由管理员确认' : '当前仅为系统默认值，尚未完成管理员确认'}
            description={settings?.configured
              ? `最近确认时间：${formatTime(settings.configuredAt)}`
              : '请核对营业时间和预约边界后保存。默认值可用于预览，但不会被验收清单视为已配置。'}
          />

          <Form<SettingsForm>
            form={form}
            layout="vertical"
            requiredMark="optional"
            disabled={loading || saving}
            onFinish={(values) => void saveSettings(values)}
          >
            <Card loading={loading} title={<Space><CalendarClock size={18} />基础规则</Space>}>
              <Row gutter={[20, 0]}>
                <Col xs={24} lg={12}>
                  <Form.Item name="timezone" label="业务时区" rules={[{ required: true, message: '请选择业务时区' }]} extra="预约日期、时段和截止时间均按此时区计算。">
                    <Select options={[
                      { label: '中国标准时间（Asia/Shanghai）', value: 'Asia/Shanghai' },
                      { label: '香港时间（Asia/Hong_Kong）', value: 'Asia/Hong_Kong' },
                      { label: '新加坡时间（Asia/Singapore）', value: 'Asia/Singapore' },
                    ]} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card loading={loading} className="mt-5" title="每周可预约时间" extra={<Typography.Text type="secondary">关闭的日期不会生成可预约时段</Typography.Text>}>
              <Flex vertical gap={4}>
                {DAYS.map(({ key, label }) => (
                  <Row key={key} gutter={[16, 8]} align="middle" className="border-b border-slate-100 py-3 last:border-b-0">
                    <Col xs={8} sm={5} md={4}>
                      <Space>
                        <Form.Item name={['weeklySchedule', key, 'enabled']} valuePropName="checked" noStyle>
                          <Switch aria-label={`${label}是否开放预约`} />
                        </Form.Item>
                        <Typography.Text strong>{label}</Typography.Text>
                      </Space>
                    </Col>
                    <Col xs={16} sm={19} md={20}>
                      <Form.List name={['weeklySchedule', key, 'windows']}>
                        {(fields, { add, remove }) => (
                          <Flex vertical gap={8}>
                            {fields.map((field, index) => (
                              <Space key={field.key} wrap>
                                <Form.Item name={[field.name, 'start']} noStyle rules={[{ required: true, message: '请填写开始时间' }]}>
                                  <Input type="time" aria-label={`${label}第${index + 1}段开始时间`} className="w-36" />
                                </Form.Item>
                                <Typography.Text type="secondary">至</Typography.Text>
                                <Form.Item name={[field.name, 'end']} noStyle rules={[{ required: true, message: '请填写结束时间' }]}>
                                  <Input type="time" aria-label={`${label}第${index + 1}段结束时间`} className="w-36" />
                                </Form.Item>
                                {fields.length > 1 ? <Button type="text" danger size="small" aria-label={`删除${label}第${index + 1}个时段`} icon={<Trash2 size={15} />} onClick={() => remove(field.name)} /> : null}
                              </Space>
                            ))}
                            <Button type="dashed" size="small" className="w-fit" icon={<Plus size={14} />} onClick={() => add({ start: '09:00', end: '18:00' })}>增加时段</Button>
                          </Flex>
                        )}
                      </Form.List>
                    </Col>
                  </Row>
                ))}
              </Flex>
            </Card>

            <Card loading={loading} className="mt-5" title="预约边界">
              <Row gutter={[20, 0]}>
                <Col xs={24} md={12} xl={6}>
                  <Form.Item name="defaultDurationMinutes" label="默认量房时长（分钟）" rules={[{ required: true }]}>
                    <InputNumber min={1} max={480} precision={0} className="w-full" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Form.Item name="slotStepMinutes" label="时段步长（分钟）" rules={[{ required: true }]} extra="默认时长须为步长的整数倍。">
                    <InputNumber min={1} max={120} precision={0} className="w-full" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Form.Item name="maxAdvanceDays" label="最远可预约（天）" rules={[{ required: true }]}>
                    <InputNumber min={1} max={180} precision={0} className="w-full" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <Form.Item name="customerRescheduleCutoffHours" label="客户改期截止（小时前）" rules={[{ required: true }]}>
                    <InputNumber min={0} max={72} precision={0} className="w-full" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Flex justify="flex-end" className="mt-5">
              <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving} disabled={loading}>保存并确认预约规则</Button>
            </Flex>
          </Form>
        </Flex>
      </PageContainer>
    </div>
  );
}
