'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  ProForm,
  ProFormCheckbox,
  ProFormDependency,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProDescriptions,
  PageContainer,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Button, Card, Col, Empty, Flex, Input, Row, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { notify } from '@/components/ui/operation-feedback';
import { useFetch } from '@/hooks/useFetch';
import { AI_PROVIDER_ADAPTER_MANIFESTS, getProviderAdapterManifest, type ProviderAdapterConfigField } from '@/lib/ai/provider-adapter-manifest';
import {
  CAPABILITIES,
  MODEL_KEYS,
  RESOLUTION_TIERS,
  type Provider,
  type ProviderFormState,
  emptyProviderForm,
  providerToForm,
} from './types';

type ProviderEditorProps = {
  providerId?: string;
};

type ProviderFields = Omit<ProviderFormState, 'id' | 'apiKey' | 'costs' | 'modelMappings'> & {
  apiKey: string;
};

const adapterOptions = Object.values(AI_PROVIDER_ADAPTER_MANIFESTS).map(({ label, type }) => ({ label, value: type }));

function AdapterConfigField({ field }: { field: ProviderAdapterConfigField }) {
  const name = ['adapterConfig', field.key];
  const rules = field.required ? [{ required: true, message: `${field.label}不能为空` }] : undefined;
  if (field.type === 'number') return <ProFormDigit name={name} label={field.label} placeholder={field.placeholder} rules={rules} />;
  if (field.type === 'select') return <ProFormSelect name={name} label={field.label} options={field.options} rules={rules} />;
  if (field.type === 'switch') return <ProFormCheckbox name={name} label={field.label} />;
  return <ProFormText name={name} label={field.label} placeholder={field.placeholder} rules={rules} />;
}

function resolveAdapterManifest(value: unknown) {
  return getProviderAdapterManifest(
    value === 'apinebula' || value === 'pollinations' || value === 'openai_compatible' || value === 'grs' ? value : 'grs'
  );
}

function RemoteModelSelect({
  value,
  options,
  optional = false,
  onChange,
}: {
  value?: string;
  options: string[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      mode="tags"
      maxCount={1}
      maxTagCount={1}
      showSearch
      allowClear={optional}
      className="w-full"
      placeholder={optional ? '全部模型' : '选择或输入远程模型'}
      value={value ? [value] : undefined}
      options={options.map((model) => ({ label: model, value: model }))}
      onChange={(values: string[]) => onChange(values[0] || '')}
    />
  );
}

export default function ProviderEditor({ providerId }: ProviderEditorProps) {
  const router = useRouter();
  const formRef = useRef<ProFormInstance<ProviderFields>>(null);
  const { data: providers, isLoading } = useFetch<Provider[]>('/api/admin/ai-providers');
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<ProviderFormState | null>(null);
  const provider = providerId ? providers?.find((item) => item.id === providerId) : undefined;
  const initialForm = useMemo(() => provider ? providerToForm(provider) : emptyProviderForm(), [provider]);
  const form = formState || initialForm;

  const discoveredModels = provider?.discoveredModels || [];

  const updateForm = (patch: Partial<ProviderFormState>) => {
    setFormState((current) => ({ ...(current || form), ...patch }));
  };

  const save = async (fields: ProviderFields) => {
    const current = formState || form;
    setSaving(true);
    try {
      const costRules = current.costs.map((rule) => ({
        logicalModelKey: rule.logicalModelKey,
        remoteModel: rule.remoteModel?.trim() || undefined,
        resolutionTier: rule.resolutionTier || undefined,
        currency: rule.currency.trim() || 'CNY',
        estimatedMicros: Number(rule.estimatedMicros || 0),
      }));
      const payload = {
        ...fields,
        modelMappings: current.modelMappings,
        costRules,
      };
      const response = await fetch(providerId ? `/api/admin/ai-providers/${providerId}` : '/api/admin/ai-providers', {
        method: providerId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存供应商失败');

      if (providerId && fields.apiKey.trim()) {
        const keyResponse = await fetch(`/api/admin/ai-providers/${providerId}/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: fields.apiKey }),
        });
        const keyResult = await keyResponse.json();
        if (!keyResponse.ok || !keyResult.success) throw new Error(keyResult.error || '配置已保存，但密钥轮换失败');
      }

      notify.success(providerId ? 'AI 供应商配置已更新' : 'AI 供应商已创建');
      router.push('/ai-providers');
      router.refresh();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存供应商失败');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && providerId) {
    return <Card loading className="border-0 shadow-none" />;
  }

  if (providerId && !provider) {
    return (
      <Card>
        <Empty description="未找到 AI 供应商" />
        <div className="text-center">
          <Button onClick={() => router.push('/ai-providers')}>返回供应商列表</Button>
        </div>
      </Card>
    );
  }

  const costColumns: ColumnsType<ProviderFormState['costs'][number]> = [
    {
      title: '逻辑模型',
      dataIndex: 'logicalModelKey',
      width: 220,
      render: (_, record, index) => (
        <Select
          value={record.logicalModelKey}
          className="w-full"
          options={MODEL_KEYS.map((key) => ({ label: key, value: key }))}
          onChange={(value) => updateForm({ costs: form.costs.map((item, itemIndex) => itemIndex === index ? { ...item, logicalModelKey: value } : item) })}
        />
      ),
    },
    {
      title: '远程模型（可选）',
      dataIndex: 'remoteModel',
      render: (_, record, index) => (
        <RemoteModelSelect
          optional
          value={record.remoteModel}
          options={discoveredModels}
          onChange={(remoteModel) => updateForm({ costs: form.costs.map((item, itemIndex) => itemIndex === index ? { ...item, remoteModel } : item) })}
        />
      ),
    },
    {
      title: '分辨率',
      dataIndex: 'resolutionTier',
      width: 140,
      render: (_, record, index) => (
        <Select
          allowClear
          value={record.resolutionTier}
          className="w-full"
          options={RESOLUTION_TIERS.map((tier) => ({ label: tier, value: tier }))}
          onChange={(value) => updateForm({ costs: form.costs.map((item, itemIndex) => itemIndex === index ? { ...item, resolutionTier: value } : item) })}
        />
      ),
    },
    {
      title: '币种',
      dataIndex: 'currency',
      width: 100,
      render: (_, record, index) => (
        <Input value={record.currency} onChange={(event) => updateForm({ costs: form.costs.map((item, itemIndex) => itemIndex === index ? { ...item, currency: event.target.value } : item) })} />
      ),
    },
    {
      title: '预计成本（微单位）',
      dataIndex: 'estimatedMicros',
      width: 180,
      render: (_, record, index) => (
        <Input type="number" min={0} value={record.estimatedMicros} onChange={(event) => updateForm({ costs: form.costs.map((item, itemIndex) => itemIndex === index ? { ...item, estimatedMicros: event.target.value } : item) })} />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 72,
      render: (_, __, index) => (
        <Button type="text" danger icon={<Trash2 size={16} />} aria-label="删除成本规则" onClick={() => updateForm({ costs: form.costs.filter((_, itemIndex) => itemIndex !== index) })} />
      ),
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={providerId ? '编辑 AI 供应商' : '新增 AI 供应商'}
        content="配置凭证、模型路由和内部成本规则。"
        onBack={() => router.push('/ai-providers')}
      >
        <ProForm<ProviderFields>
        key={`${providerId || 'new'}-${initialForm.key}`}
        formRef={formRef}
        layout="vertical"
        initialValues={initialForm}
        onValuesChange={(changedValues) => {
          if (!changedValues.adapterType) return;
          const manifest = resolveAdapterManifest(changedValues.adapterType);
          formRef.current?.setFieldsValue({
            baseUrl: manifest.defaultBaseUrl,
            capabilities: manifest.defaultCapabilities,
            adapterConfig: {},
          });
        }}
        submitter={{
          searchConfig: { submitText: providerId ? '保存更改' : '创建供应商', resetText: '取消' },
          submitButtonProps: { loading: saving, icon: <Save size={16} /> },
          resetButtonProps: { onClick: () => router.push('/ai-providers') },
          render: (_, dom) => <Flex gap={12} className="admin-form-actions">{dom}</Flex>,
        }}
        onFinish={save}
      >
        <Flex vertical gap={24} className="admin-config-stack">
          {provider ? (
            <Card title="当前状态" className="admin-panel-card">
            <ProDescriptions
              column={{ xs: 1, sm: 2, lg: 4 }}
              dataSource={provider}
              columns={[
                { title: '供应商标识', dataIndex: 'key' },
                { title: '适配器', dataIndex: 'adapterType' },
                { title: '当前凭证', dataIndex: 'apiKeyMasked', render: (value) => value || '未配置' },
                { title: '连接状态', dataIndex: 'lastTestOk', render: (value) => value === true ? <Tag color="success">正常</Tag> : value === false ? <Tag color="error">失败</Tag> : <Tag>未测试</Tag> },
              ]}
            />
            </Card>
          ) : null}
          <Card title="基础配置" className="admin-panel-card">
          <Row gutter={[20, 4]}>
            <Col xs={24} md={12} lg={6}><ProFormText name="key" label="供应商标识" disabled={Boolean(providerId)} placeholder="grs-primary" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12} lg={6}><ProFormText name="name" label="名称" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12} lg={6}><ProFormSelect name="adapterType" label="适配器" options={adapterOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12} lg={6}>
              <ProFormDependency name={['adapterType']}>
                {({ adapterType }) => {
                  const credential = resolveAdapterManifest(adapterType).credentialFields[0];
                  return <ProFormText name="apiKey" label={providerId ? `${credential.label}（可选轮换）` : credential.label} placeholder={credential.placeholder} fieldProps={{ type: 'password' }} rules={providerId ? undefined : [{ required: credential.required }]} />;
                }}
              </ProFormDependency>
            </Col>
            <Col xs={24} md={12}>
              <ProFormDependency name={['adapterType']}>
                {({ adapterType }) => {
                  const manifest = resolveAdapterManifest(adapterType);
                  return <ProFormText name="baseUrl" label="服务地址" placeholder={manifest.baseUrlPlaceholder} rules={[{ required: true, type: 'url' }]} />;
                }}
              </ProFormDependency>
            </Col>
            <Col xs={24} md={6}><ProFormDigit name="priority" label="优先级" min={0} fieldProps={{ precision: 0 }} /></Col>
            <Col xs={24} md={6}><ProFormDigit name="timeoutMs" label="超时（毫秒）" min={1000} fieldProps={{ precision: 0 }} /></Col>
            <Col span={24}><ProFormCheckbox.Group name="capabilities" label="能力" options={CAPABILITIES.map((value) => ({ label: value, value }))} /></Col>
            <Col span={24}><ProFormCheckbox name="enabled" label="启用供应商" /></Col>
            <Col span={24}>
              <ProFormDependency name={['adapterType']}>
                {({ adapterType }) => {
                  const manifest = resolveAdapterManifest(adapterType);
                  return (
                    <Flex vertical gap={4}>
                      <Typography.Text strong>{manifest.label} 适配器</Typography.Text>
                      <Typography.Text type="secondary">{manifest.description}</Typography.Text>
                      {manifest.configFields.length ? <Row gutter={[20, 4]}>{manifest.configFields.map((field) => <Col key={field.key} xs={24} md={8}><AdapterConfigField field={field} /></Col>)}</Row> : null}
                    </Flex>
                  );
                }}
              </ProFormDependency>
            </Col>
          </Row>
          </Card>

          <Card title="模型路由" className="admin-panel-card">
          <Typography.Paragraph type="secondary">逻辑模型用于默认业务路由。图片任务按供应商优先级执行，仅在请求明确未被上游受理时安全切换；自由创作只会切换到远程模型名完全相同的供应商。</Typography.Paragraph>
          <Table
            size="middle"
            pagination={false}
            rowKey="key"
            dataSource={MODEL_KEYS.map((key) => ({ key, value: form.modelMappings[key] || '' }))}
            columns={[
              { title: '逻辑模型', dataIndex: 'key', width: 280, render: (value: string) => <Tag>{value}</Tag> },
              { title: '默认远程模型', dataIndex: 'value', render: (value: string, record: { key: string }) => <RemoteModelSelect value={value} options={discoveredModels} onChange={(remoteModel) => updateForm({ modelMappings: { ...form.modelMappings, [record.key]: remoteModel } })} /> },
            ]}
          />
          </Card>

          <Card title="供应商内部成本规则" className="admin-panel-card">
            <Flex vertical gap={16}>
            <Typography.Paragraph type="secondary" className="!mb-0">成本规则仅用于内部成本快照与毛利核算，不会发送给上游服务，也不会改变企业 AI 点数。</Typography.Paragraph>
            <Button type="dashed" icon={<Plus size={16} />} onClick={() => updateForm({ costs: [...form.costs, { logicalModelKey: 'image.generate.standard', currency: 'CNY', estimatedMicros: '0' }] })}>新增成本规则</Button>
            <Table<ProviderFormState['costs'][number]> size="middle" scroll={{ x: 980 }} pagination={false} rowKey={(_, index) => String(index)} dataSource={form.costs} columns={costColumns} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无成本规则" /> }} />
            </Flex>
          </Card>
        </Flex>
        </ProForm>
      </PageContainer>
    </div>
  );
}
