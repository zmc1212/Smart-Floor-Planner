'use client';

import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Button, Empty, InputNumber, Radio, Space, Switch, Tag, Typography } from 'antd';
import { notify } from '@/components/ui/operation-feedback';
import type { ImageModel } from './types';

export default function ImageModelCatalog() {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadModels = useCallback(async () => {
    const response = await fetch('/api/admin/ai-image-models');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '读取生图模型目录失败');
    setModels(result.data || []);
    setModelsLoaded(true);
  }, []);

  useEffect(() => {
    void loadModels().catch((error) => notify.error(error instanceof Error ? error.message : '读取生图模型目录失败'));
  }, [loadModels]);

  const saveModels = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/ai-image-models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: models
            .filter((model) => model.executable)
            .map(({ id, enabled, isDefault, maxReferenceImages }) => ({ id, enabled, isDefault, maxReferenceImages })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存生图模型目录失败');
      await loadModels();
      notify.success('生图模型目录已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存生图模型目录失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ProColumns<ImageModel>[] = [
    {
      title: '模型',
      dataIndex: 'name',
      width: 260,
      render: (_, model) => (
        <Space direction="vertical" size={0}>
          <Space>
            <Typography.Text strong>{model.name}</Typography.Text>
            {!model.executable ? <Tag>只读发现</Tag> : null}
          </Space>
          <Typography.Text type="secondary" className="font-mono text-xs">{model.remoteModel}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '模型族',
      dataIndex: 'family',
      width: 160,
      render: (family, model) => (
        <Space direction="vertical" size={2}>
          <Tag>{family}</Tag>
          <Typography.Text type="secondary" className="text-xs">
            {model.catalogVersion ? `目录 ${model.catalogVersion}` : '缺少参数能力定义'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '分辨率能力',
      dataIndex: 'resolutionTiers',
      render: (_, model) => (
        <Space direction="vertical" size={4}>
          <Space size={[4, 4]} wrap>{model.resolutionTiers.map((tier) => <Tag key={tier}>{tier}</Tag>)}</Space>
          {model.supportsCustomSize ? <Typography.Text type="secondary" className="text-xs">支持自定义尺寸</Typography.Text> : null}
        </Space>
      ),
    },
    { title: '比例数量', dataIndex: 'aspectRatios', width: 120, render: (_, model) => model.aspectRatios.length },
    {
      title: '参考图上限',
      dataIndex: 'maxReferenceImages',
      width: 150,
      render: (_, model, index) => (
        <InputNumber
          min={0}
          max={10}
          value={model.maxReferenceImages}
          disabled={!model.executable}
          onChange={(value) => setModels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxReferenceImages: Number(value || 0) } : item))}
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 100,
      render: (_, model, index) => (
        <Switch
          checked={model.enabled}
          disabled={!model.executable}
          onChange={(enabled) => setModels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled, isDefault: enabled ? item.isDefault : false } : item))}
        />
      ),
    },
    {
      title: '平台默认',
      dataIndex: 'isDefault',
      width: 120,
      render: (_, model, index) => (
        <Radio
          checked={model.isDefault}
          disabled={!model.executable || !model.enabled}
          onChange={() => setModels((current) => current.map((item, itemIndex) => ({ ...item, isDefault: itemIndex === index })))}
        />
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="生图模型"
        content="管理平台对业务开放的生图模型、默认模型和参考图上限。当前目录来源为 GRS，后续供应商通过 Adapter 接入同一目录。"
        extra={[
          <Button key="save" type="primary" icon={<Save size={16} />} disabled={!modelsLoaded || !models.length} loading={saving} onClick={saveModels}>保存模型目录</Button>,
        ]}
      >
        <ProTable<ImageModel>
          rowKey="id"
          columns={columns}
          dataSource={models}
          loading={!modelsLoaded}
          search={false}
          options={false}
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生图模型目录" /> }}
        />
      </PageContainer>
    </div>
  );
}
