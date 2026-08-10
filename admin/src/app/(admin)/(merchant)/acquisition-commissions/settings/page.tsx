'use client';

import { useEffect, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Flex, Form, InputNumber, Skeleton, Typography } from 'antd';
import { Coins } from 'lucide-react';
import { CommissionSectionTabs } from '@/components/acquisition-commissions/commission-section-tabs';
import { notify } from '@/components/ui/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type CommissionSettings = {
  enterpriseName: string;
  measurerAcquisitionFixedCommission: number;
};

export default function AcquisitionCommissionSettingsPage() {
  const [form] = Form.useForm<{ measurerAcquisitionFixedCommission: number }>();
  const { user: currentUser, isLoading: isUserLoading } = useCurrentUser();
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isEnterpriseAdmin = currentUser?.role === 'enterprise_admin';

  useEffect(() => {
    if (!isEnterpriseAdmin) {
      setLoading(false);
      return;
    }
    void fetch('/api/acquisition-commissions/settings')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取获客提成规则失败');
        const nextSettings = result.data as CommissionSettings;
        setSettings(nextSettings);
        form.setFieldsValue({ measurerAcquisitionFixedCommission: nextSettings.measurerAcquisitionFixedCommission });
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取获客提成规则失败'))
      .finally(() => setLoading(false));
  }, [form, isEnterpriseAdmin]);

  const save = async ({ measurerAcquisitionFixedCommission }: { measurerAcquisitionFixedCommission: number }) => {
    setSaving(true);
    try {
      const response = await fetch('/api/acquisition-commissions/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measurerAcquisitionFixedCommission }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存获客提成规则失败');
      const nextSettings = result.data as CommissionSettings;
      setSettings(nextSettings);
      form.setFieldsValue({ measurerAcquisitionFixedCommission: nextSettings.measurerAcquisitionFixedCommission });
      notify.success('获客提成规则已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存获客提成规则失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        title="获客提成"
        content="管理本企业的获客提成结算与规则。"
      >
        <Flex vertical gap={24}>
          <CommissionSectionTabs activeKey="settings" />
          {isUserLoading || loading ? (
            <Card className="admin-panel-card"><Skeleton active paragraph={{ rows: 4 }} /></Card>
          ) : !isEnterpriseAdmin ? (
            <Alert
              showIcon
              type="warning"
              message="仅企业负责人可配置提成规则"
              description="企业负责人可为本企业设置每条已确认获客线索的固定提成金额。"
            />
          ) : (
            <Card
              className="admin-panel-card"
              title={<Flex align="center" gap={8}><Coins size={18} className="text-primary" />提成规则</Flex>}
            >
              <Flex vertical gap={20} className="max-w-xl">
                <Typography.Text type="secondary">
                  {settings?.enterpriseName || '当前企业'}：测量员每条已确认获客线索的固定提成金额。
                </Typography.Text>
                <Alert
                  showIcon
                  type="info"
                  message="新规则仅对之后新确认的获客线索生效"
                  description="已生成的待结算和已发放记录使用确认时的金额快照，不会因修改规则而改变。"
                />
                <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
                  <Form.Item
                    label="固定提成金额"
                    name="measurerAcquisitionFixedCommission"
                    rules={[{ required: true, message: '请输入固定提成金额' }]}
                  >
                    <InputNumber min={0} precision={2} addonAfter="元 / 条" className="w-full" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={saving}>保存规则</Button>
                </Form>
              </Flex>
            </Card>
          )}
        </Flex>
      </PageContainer>
    </div>
  );
}
