'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PageContainer,
  ProDescriptions,
  ProForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Alert, Button, Card, Col, Empty, Flex, Result, Row, Skeleton, Tag } from 'antd';
import { Save } from 'lucide-react';
import { notify } from '@/components/ui/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFetch } from '@/hooks/useFetch';
import {
  AI_PRESET_TYPE_LABELS,
  type AiPreset,
  resolveLogicalModel,
} from './types';

type PresetEditorProps = {
  presetId: string;
};

type PresetFormValues = Pick<
  AiPreset,
  | 'name'
  | 'description'
  | 'icon'
  | 'previewClassName'
  | 'mockImageUrl'
  | 'promptTemplate'
  | 'promptTemplateSecondStage'
  | 'negativePrompt'
  | 'enabled'
  | 'sortOrder'
  | 'image'
>;

const LOGICAL_MODEL_OPTIONS = [
  { label: 'image.generate.standard', value: 'image.generate.standard' },
  { label: 'image.edit.standard', value: 'image.edit.standard' },
];

const QUALITY_OPTIONS = ['low', 'medium', 'high', 'standard', 'hd'].map((value) => ({
  label: value.toUpperCase(),
  value,
}));

const MODE_OPTIONS = [
  { label: '图生图（Edit）', value: 'edit' },
  { label: '文生图（Generation）', value: 'generation' },
];

export default function PresetEditor({ presetId }: PresetEditorProps) {
  const router = useRouter();
  const { user, isLoading: loadingUser } = useCurrentUser();
  const canManage = user?.role === 'super_admin' || user?.role === 'admin';
  const { data: presets, isLoading } = useFetch<AiPreset[]>(
    canManage ? '/api/ai/presets?includeDisabled=true' : null,
  );
  const [saving, setSaving] = useState(false);
  const preset = useMemo(
    () => presets?.find((item) => item._id === presetId),
    [presetId, presets],
  );

  const save = async (values: PresetFormValues) => {
    if (!preset) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/presets/${preset._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          icon: values.icon,
          previewClassName: values.previewClassName,
          mockImageUrl: values.mockImageUrl,
          promptTemplate: values.promptTemplate,
          promptTemplateSecondStage: values.promptTemplateSecondStage,
          negativePrompt: values.negativePrompt,
          enabled: values.enabled,
          sortOrder: values.sortOrder,
          image: { ...preset.image, ...values.image },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存 AI 预设失败');

      notify.success('AI 预设已保存');
      router.push('/ai-presets');
      router.refresh();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存 AI 预设失败');
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser || (canManage && isLoading)) {
    return (
      <div className="admin-page-frame">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="admin-page-frame">
        <PageContainer breadcrumbRender={false} className="admin-page-container" title="编辑 AI 预设">
          <Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以管理 AI 预设。" />
        </PageContainer>
      </div>
    );
  }

  if (!preset) {
    return (
      <div className="admin-page-frame">
        <PageContainer
          breadcrumbRender={false}
          className="admin-page-container"
          title="编辑 AI 预设"
          onBack={() => router.push('/ai-presets')}
        >
          <Card className="admin-panel-card">
            <Empty description="未找到 AI 预设" />
            <div className="text-center">
              <Button onClick={() => router.push('/ai-presets')}>返回预设列表</Button>
            </div>
          </Card>
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title={`编辑预设：${preset.name}`}
        content="修改会影响后台与小程序的 AI 设计入口；请保留空间结构和镜头约束。"
        onBack={() => router.push('/ai-presets')}
      >
        <ProForm<PresetFormValues>
          key={preset._id}
          layout="vertical"
          initialValues={{
            ...preset,
            image: {
              ...preset.image,
              logicalModelKey: resolveLogicalModel(preset),
            },
          }}
          submitter={{
            searchConfig: { submitText: '保存预设', resetText: '取消' },
            submitButtonProps: { loading: saving, icon: <Save size={16} /> },
            resetButtonProps: { onClick: () => router.push('/ai-presets') },
            render: (_, dom) => <Flex gap={12} className="admin-form-actions">{dom}</Flex>,
          }}
          onFinish={save}
        >
          <Flex vertical gap={24} className="admin-config-stack">
            <Card title="预设概览" className="admin-panel-card">
              <ProDescriptions<AiPreset>
                column={{ xs: 1, sm: 2, lg: 4 }}
                dataSource={preset}
                columns={[
                  { title: '预设标识', dataIndex: 'key', copyable: true },
                  { title: '类型', dataIndex: 'type', render: (_, item) => <Tag color="green">{AI_PRESET_TYPE_LABELS[item.type]}</Tag> },
                  { title: '供应商', dataIndex: 'provider', render: (value) => value || '平台默认路由' },
                  { title: '工作流阶段', dataIndex: 'workflowStage', render: (value) => value || '—' },
                ]}
              />
            </Card>

            <Card title="基础信息" className="admin-panel-card">
              <Row gutter={[20, 4]}>
                <Col xs={24} md={12}><ProFormText name="name" label="名称" rules={[{ required: true, message: '请输入预设名称' }]} /></Col>
                <Col xs={24} md={6}><ProFormText name="icon" label="图标简称" tooltip="用于列表中的简短识别，建议 2–3 个字符。" /></Col>
                <Col xs={24} md={6}><ProFormDigit name="sortOrder" label="排序权重" fieldProps={{ precision: 0 }} /></Col>
                <Col span={24}><ProFormTextArea name="description" label="用途描述" fieldProps={{ autoSize: { minRows: 2, maxRows: 4 } }} /></Col>
                <Col xs={24} md={12}><ProFormText name="previewClassName" label="预览样式标识" tooltip="保留现有数据；前端会在支持该样式的视图中使用。" /></Col>
                <Col xs={24} md={12}><ProFormText name="mockImageUrl" label="Mock 预览图地址" placeholder="/static/previews/modern.png" /></Col>
                <Col span={24}>
                  <ProFormSwitch
                    name="enabled"
                    label="启用预设"
                    tooltip="停用后，该预设从用户侧可选列表隐藏。"
                    fieldProps={{ checkedChildren: '已启用', unCheckedChildren: '已停用' }}
                  />
                </Col>
              </Row>
            </Card>

            <Card title="提示词模板" className="admin-panel-card">
              <Flex vertical gap={16}>
                <Alert
                  type="warning"
                  showIcon
                  message="修改前请核对空间约束"
                  description="提示词应明确继承上阶段产物，并保留户型骨架、墙体、门窗与镜头关系。"
                />
                <ProFormTextArea
                  name="promptTemplate"
                  label="Prompt 提示词模板"
                  rules={[{ required: true, message: '请输入提示词模板' }]}
                  fieldProps={{ autoSize: { minRows: 8, maxRows: 18 } }}
                />
                <ProFormTextArea
                  name="promptTemplateSecondStage"
                  label="级联生成第二阶段（可选）"
                  tooltip="仅用于需要两阶段生成的工作流。"
                  fieldProps={{ autoSize: { minRows: 5, maxRows: 12 } }}
                />
                <ProFormTextArea
                  name="negativePrompt"
                  label="负向提示词（Negative Prompt）"
                  fieldProps={{ autoSize: { minRows: 4, maxRows: 10 } }}
                />
              </Flex>
            </Card>

            <Card title="生图参数" className="admin-panel-card">
              <Row gutter={[20, 4]}>
                <Col xs={24} md={12} lg={6}>
                  <ProFormSelect
                    name={['image', 'logicalModelKey']}
                    label="逻辑模型"
                    options={LOGICAL_MODEL_OPTIONS}
                    rules={[{ required: true, message: '请选择逻辑模型' }]}
                  />
                </Col>
                <Col xs={24} md={12} lg={6}><ProFormText name={['image', 'model']} label="历史远程模型" disabled /></Col>
                <Col xs={24} md={12} lg={4}><ProFormText name={['image', 'size']} label="分辨率" rules={[{ required: true }]} /></Col>
                <Col xs={24} md={12} lg={4}><ProFormSelect name={['image', 'quality']} label="画质" options={QUALITY_OPTIONS} rules={[{ required: true }]} /></Col>
                <Col xs={24} md={12} lg={4}><ProFormSelect name={['image', 'mode']} label="工作模式" options={MODE_OPTIONS} rules={[{ required: true }]} /></Col>
              </Row>
            </Card>
          </Flex>
        </ProForm>
      </PageContainer>
    </div>
  );
}
