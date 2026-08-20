'use client';

import {
  ProForm,
  ProFormDigit,
  ProFormSwitch,
} from '@ant-design/pro-components';
import { Card, Col, Flex, Row, Typography } from 'antd';
import { Bell, Clock3, Save } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { EnterpriseListItem } from './types';

interface EnterpriseAutomationManagerProps {
  enterprise: EnterpriseListItem;
  onRefresh?: () => Promise<void> | void;
}

interface AutomationFormState {
  followUpSlaHours: number;
  measureTaskSlaHours: number;
  designTaskSlaHours: number;
  reminderIntervalHours: number;
  maxReminderTimes: number;
  miniprogramNotificationEnabled: boolean;
}

function buildAutomationForm(enterprise: EnterpriseListItem): AutomationFormState {
  return {
    followUpSlaHours: enterprise.automationConfig?.followUpSlaHours ?? 24,
    measureTaskSlaHours: enterprise.automationConfig?.measureTaskSlaHours ?? 48,
    designTaskSlaHours: enterprise.automationConfig?.designTaskSlaHours ?? 72,
    reminderIntervalHours: enterprise.automationConfig?.reminderIntervalHours ?? 24,
    maxReminderTimes: enterprise.automationConfig?.maxReminderTimes ?? 3,
    miniprogramNotificationEnabled: enterprise.automationConfig?.miniprogramNotificationEnabled !== false,
  };
}

export default function EnterpriseAutomationManager({
  enterprise,
  onRefresh,
}: EnterpriseAutomationManagerProps) {
  const save = async (values: AutomationFormState) => {
    try {
      const response = await fetch(`/api/admin/enterprises/${enterprise._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automationConfig: values }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存自动化配置失败');

      notify.success('自动化配置已保存');
      await onRefresh?.();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存自动化配置失败');
      return false;
    }
  };

  const values = buildAutomationForm(enterprise);

  return (
    <ProForm<AutomationFormState>
      key={`${enterprise._id}:${JSON.stringify(values)}`}
      layout="vertical"
      initialValues={values}
      onFinish={save}
      submitter={{
        searchConfig: { submitText: '保存配置' },
        submitButtonProps: { icon: <Save size={16} /> },
        render: (_, dom) => <Flex justify="end" gap={12} className="admin-form-actions">{dom}</Flex>,
      }}
    >
      <Flex vertical gap={24} className="admin-config-stack">
        <Card title="通知渠道" extra={<Bell className="text-amber-600" size={18} />} className="admin-panel-card">
          <Row gutter={[24, 12]}>
            <Col xs={24} md={12}>
              <ProFormSwitch
                name="miniprogramNotificationEnabled"
                label="微信小程序通知"
                tooltip="控制微信订阅消息发送；关闭后会记录跳过日志。"
                fieldProps={{ checkedChildren: '已开启', unCheckedChildren: '已关闭' }}
              />
            </Col>
          </Row>
          <Typography.Paragraph type="secondary" className="!mb-0 !mt-2">
            关闭小程序通知后仍会保留站内通知与处理日志。
          </Typography.Paragraph>
        </Card>

        <Card title="SLA 与催办规则" extra={<Clock3 className="text-muted-foreground" size={18} />} className="admin-panel-card">
          <Row gutter={[20, 4]}>
            <Col xs={24} md={12}><ProFormDigit name="followUpSlaHours" label="跟进 SLA（小时）" min={1} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><ProFormDigit name="measureTaskSlaHours" label="测量任务 SLA（小时）" min={1} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><ProFormDigit name="designTaskSlaHours" label="设计任务 SLA（小时）" min={1} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><ProFormDigit name="reminderIntervalHours" label="超时提醒间隔（小时）" min={1} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><ProFormDigit name="maxReminderTimes" label="最多提醒次数" min={1} fieldProps={{ precision: 0, className: 'w-full' }} rules={[{ required: true }]} /></Col>
          </Row>
        </Card>
      </Flex>
    </ProForm>
  );
}
