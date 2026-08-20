'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Flex, InputNumber, Switch, Tag, Typography } from 'antd';
import { Save } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useFetch } from '@/hooks/useFetch';

type PriceItem = {
  _id: string;
  actionKey: string;
  label: string;
  credits: number;
  enabled: boolean;
};

type ModelPriceItem = {
  id?: string;
  actionKey: string;
  modelProfileKey: string;
  resolutionTier: '1K' | '2K' | '4K' | 'CUSTOM';
  label: string;
  credits: number;
  enabled: boolean;
};

function normalizeCredits(value: number | null) {
  return Math.min(100000, Math.max(1, Math.trunc(Number(value || 1))));
}

export default function AiCreditPricesPage() {
  const { data, isLoading, mutate } = useFetch<PriceItem[]>('/api/admin/ai-credit-prices');
  const {
    data: modelPriceData,
    isLoading: modelPricesLoading,
    mutate: mutateModelPrices,
  } = useFetch<ModelPriceItem[]>('/api/admin/ai-image-model-prices');
  const [items, setItems] = useState<PriceItem[]>([]);
  const [modelPrices, setModelPrices] = useState<ModelPriceItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => setItems(data || []), [data]);
  useEffect(() => setModelPrices(modelPriceData || []), [modelPriceData]);

  const hasChanges = useMemo(() => {
    if (!data || !modelPriceData) return false;
    return JSON.stringify(items) !== JSON.stringify(data)
      || JSON.stringify(modelPrices) !== JSON.stringify(modelPriceData);
  }, [data, items, modelPriceData, modelPrices]);

  const updateItem = (actionKey: string, patch: Partial<PriceItem>) => {
    setItems((current) => current.map((item) => item.actionKey === actionKey ? { ...item, ...patch } : item));
  };

  const updateModelPrice = (modelProfileKey: string, resolutionTier: ModelPriceItem['resolutionTier'], patch: Partial<ModelPriceItem>) => {
    setModelPrices((current) => current.map((item) => (
      item.modelProfileKey === modelProfileKey && item.resolutionTier === resolutionTier
        ? { ...item, ...patch }
        : item
    )));
  };

  const save = async () => {
    setSaving(true);
    let actionPricesSaved = false;
    try {
      const response = await fetch('/api/admin/ai-credit-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(({ actionKey, credits, enabled }) => ({ actionKey, credits, enabled })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '场景动作价格保存失败');
      actionPricesSaved = true;

      const modelResponse = await fetch('/api/admin/ai-image-model-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: modelPrices.map(({ modelProfileKey, resolutionTier, credits, enabled }) => ({
            modelProfileKey,
            resolutionTier,
            credits,
            enabled,
          })),
        }),
      });
      const modelResult = await modelResponse.json();
      if (!modelResponse.ok || !modelResult.success) {
        throw new Error(modelResult.error || '自由创作模型价格保存失败');
      }

      await Promise.all([mutate(), mutateModelPrices()]);
      notify.success('AI 点数价格已保存');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 AI 点数价格失败';
      notify.error(actionPricesSaved ? `场景动作价格已保存；${message}` : message);
    } finally {
      setSaving(false);
    }
  };

  const actionColumns: ProColumns<PriceItem>[] = [
    {
      title: '业务动作',
      dataIndex: 'label',
      render: (_, item) => (
        <Flex vertical gap={2}>
          <Typography.Text strong>{item.label}</Typography.Text>
          <Typography.Text type="secondary" className="font-mono text-xs">{item.actionKey}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '成功扣除点数',
      dataIndex: 'credits',
      width: 220,
      render: (_, item) => (
        <InputNumber
          aria-label={`${item.label} 成功扣除点数`}
          className="w-full"
          min={1}
          max={100000}
          precision={0}
          value={item.credits}
          onChange={(value) => updateItem(item.actionKey, { credits: normalizeCredits(value) })}
        />
      ),
    },
    {
      title: '允许使用',
      dataIndex: 'enabled',
      width: 130,
      render: (_, item) => (
        <Switch
          aria-label={`${item.enabled ? '停用' : '启用'} ${item.label}`}
          checked={item.enabled}
          checkedChildren="已启用"
          unCheckedChildren="已停用"
          onChange={(enabled) => updateItem(item.actionKey, { enabled })}
        />
      ),
    },
  ];

  const modelColumns: ProColumns<ModelPriceItem>[] = [
    {
      title: '模型档位',
      dataIndex: 'label',
      width: 260,
      render: (_, item) => <Typography.Text strong>{item.label}</Typography.Text>,
    },
    {
      title: '模型档案',
      dataIndex: 'modelProfileKey',
      width: 280,
      render: (value) => <Typography.Text className="font-mono text-xs">{value}</Typography.Text>,
    },
    {
      title: '分辨率',
      dataIndex: 'resolutionTier',
      width: 110,
      render: (value) => <Tag>{value}</Tag>,
    },
    {
      title: '成功扣除点数',
      dataIndex: 'credits',
      width: 220,
      render: (_, item) => (
        <InputNumber
          aria-label={`${item.label} ${item.resolutionTier} 成功扣除点数`}
          className="w-full"
          min={1}
          max={100000}
          precision={0}
          value={item.credits}
          onChange={(value) => updateModelPrice(
            item.modelProfileKey,
            item.resolutionTier,
            { credits: normalizeCredits(value) },
          )}
        />
      ),
    },
    {
      title: '允许使用',
      dataIndex: 'enabled',
      width: 130,
      render: (_, item) => (
        <Switch
          aria-label={`${item.enabled ? '停用' : '启用'} ${item.label} ${item.resolutionTier}`}
          checked={item.enabled}
          checkedChildren="已启用"
          unCheckedChildren="已停用"
          onChange={(enabled) => updateModelPrice(item.modelProfileKey, item.resolutionTier, { enabled })}
        />
      ),
    },
  ];

  const loading = isLoading || modelPricesLoading;

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="AI 点数价格"
        content="统一管理业务动作扣点与自由创作模型分辨率定价；供应商内部成本仍独立核算。"
        extra={[
          hasChanges ? <Tag key="dirty" color="warning">有未保存更改</Tag> : null,
          <Button
            key="save"
            type="primary"
            icon={<Save size={16} />}
            loading={saving}
            disabled={loading || !items.length || !modelPrices.length || !hasChanges}
            onClick={save}
          >
            保存价格
          </Button>,
        ]}
      >
        <Flex vertical gap={28} className="admin-config-stack">
          <Alert
            type="info"
            showIcon
            message="扣点时机"
            description="AI 任务创建时冻结点数，成功后按此处快照扣除，失败时释放。价格变更只影响后续新任务。"
          />

          <section className="space-y-4" aria-labelledby="action-price-title">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <Typography.Title id="action-price-title" level={4} className="!mb-0">场景动作价格</Typography.Title>
                <Typography.Text type="secondary">
                  客户方案工作流和小程序按业务动作扣点，并继续使用平台场景默认模型。
                </Typography.Text>
              </div>
              <Tag color="green">{items.filter((item) => item.enabled).length} 项已启用</Tag>
            </div>
            <Typography.Text type="secondary">
              每次成功执行均使用创建任务时的价格快照，不会受之后的价格调整影响。
            </Typography.Text>
            <ProTable<PriceItem>
              rowKey="actionKey"
              columns={actionColumns}
              dataSource={items}
              loading={isLoading}
              search={false}
              options={false}
              pagination={false}
              scroll={{ x: 720 }}
            />
          </section>

          <section className="space-y-4" aria-labelledby="model-price-title">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <Typography.Title id="model-price-title" level={4} className="!mb-0">自由创作模型价格</Typography.Title>
                <Typography.Text type="secondary">
                  只有启用模型且至少一个分辨率价格已启用时，才会在自由创作台中显示。
                </Typography.Text>
              </div>
              <Tag color="green">{modelPrices.filter((item) => item.enabled).length} 档可用</Tag>
            </div>
            <Typography.Text type="secondary">
              VIP 自定义尺寸统一使用 CUSTOM 价格；供应商内部成本不在本页展示或结算。
            </Typography.Text>
            <ProTable<ModelPriceItem>
              rowKey={(item) => `${item.modelProfileKey}:${item.resolutionTier}`}
              columns={modelColumns}
              dataSource={modelPrices}
              loading={modelPricesLoading}
              search={false}
              options={false}
              pagination={false}
              scroll={{ x: 1000 }}
            />
          </section>
        </Flex>
      </PageContainer>
    </div>
  );
}
