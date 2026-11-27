'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Result,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { ArrowDown, ArrowUp, Bot, Plus, Trash2 } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { MiniProgramAiEntriesCard } from '@/components/assistant/mini-program-ai-entries';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  DEFAULT_PUBLIC_ASSISTANT_CONFIG,
  type PublicAssistantConfig,
  type PublicAssistantPrompt,
} from '@/lib/assistant/public-config-values';

function cloneDefault(version = DEFAULT_PUBLIC_ASSISTANT_CONFIG.version): PublicAssistantConfig {
  return {
    ...DEFAULT_PUBLIC_ASSISTANT_CONFIG,
    prompts: DEFAULT_PUBLIC_ASSISTANT_CONFIG.prompts.map((item) => ({ ...item })),
    version,
  };
}

export default function PublicAssistantPage() {
  const { user, isLoading: loadingUser } = useCurrentUser();
  const canManage = user?.role === 'super_admin' || user?.role === 'admin';
  const [config, setConfig] = useState<PublicAssistantConfig>(cloneDefault);
  const [savedConfig, setSavedConfig] = useState<PublicAssistantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/platform/public-assistant-config');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取通用小K配置失败');
      const next = result.data as PublicAssistantConfig;
      setConfig(next);
      setSavedConfig(next);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取通用小K配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManage) void load();
  }, [canManage]);

  const updatePrompt = (index: number, patch: Partial<PublicAssistantPrompt>) => {
    setConfig((current) => ({
      ...current,
      prompts: current.prompts.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const movePrompt = (index: number, delta: -1 | 1) => {
    setConfig((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.prompts.length) return current;
      const prompts = [...current.prompts];
      [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
      return { ...current, prompts };
    });
  };

  const save = async () => {
    if (!config.opening.trim() || !config.prompts.length || config.prompts.some((item) => !item.title.trim() || !item.text.trim())) {
      notify.error('请填写开场白和每个猜你想问');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/platform/public-assistant-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: config.enabled, opening: config.opening, prompts: config.prompts, expectedVersion: config.version }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存通用小K配置失败');
      const next = result.data as PublicAssistantConfig;
      setConfig(next);
      setSavedConfig(next);
      notify.success(next.enabled ? '通用小K已发布' : '通用小K已停用');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存通用小K配置失败');
      if (String(error instanceof Error ? error.message : '').includes('版本已变化')) void load();
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser) return <div className="admin-page-frame"><Skeleton active /></div>;
  if (user && !canManage) {
    return <PageContainer breadcrumbRender={false} title="平台通用小K"><Result status="403" title="无权访问" subTitle="仅平台 admin / super_admin 可以配置平台通用小K。" /></PageContainer>;
  }

  const savedEnabled = savedConfig?.enabled ?? false;
  const savedVersion = savedConfig?.version ?? config.version;

  return <div className="admin-page-frame"><PageContainer
    breadcrumbRender={false}
    className="admin-page-container"
    title="平台通用小K"
    subTitle="面向尚未关联装修企业的散客，提供通用装修问答和服务关联引导"
  >
    {canManage && <MiniProgramAiEntriesCard />}
    <Card loading={loading} className="admin-panel-card">
      <Space direction="vertical" size={22} className="w-full">
        <Alert
          showIcon
          type={savedEnabled ? 'info' : 'warning'}
          message={<Space><Bot size={17} />公共咨询入口 <Tag color={savedEnabled ? 'green' : undefined}>{savedEnabled ? '已发布' : '已停用'}</Tag><Tag>v{savedVersion}</Tag></Space>}
          description="散客可以先咨询装修常识。涉及找设计师或查看具体企业服务时，小K会引导用户扫码关联；企业知识、项目记录和内部资料不会从这里带入。"
        />
        <div>
          <Typography.Title level={5}>入口状态</Typography.Title>
          <Switch checked={config.enabled} onChange={(enabled) => setConfig((current) => ({ ...current, enabled }))} checkedChildren="已发布" unCheckedChildren="已停用" />
        </div>
        <Divider />
        <div>
          <Typography.Title level={5}>开场白</Typography.Title>
          <Input.TextArea rows={4} maxLength={600} showCount value={config.opening} onChange={(event) => setConfig((current) => ({ ...current, opening: event.target.value }))} />
        </div>
        <div>
          <Typography.Title level={5}>猜你想问 <Typography.Text type="secondary">最多 3 个</Typography.Text></Typography.Title>
          <Space direction="vertical" size={14} className="w-full">
            {config.prompts.map((item, index) => <Card key={index} size="small" className="w-full">
              <Space direction="vertical" size={10} className="w-full">
                <Space align="start" className="w-full">
                  <Input style={{ flex: 1, minWidth: 0 }} maxLength={12} showCount value={item.title} placeholder="卡片标题，例如：装修先做什么" onChange={(event) => updatePrompt(index, { title: event.target.value })} />
                  <Space size={0}>
                    <Button type="text" icon={<ArrowUp size={16} />} aria-label={`上移猜你想问 ${index + 1}`} title="上移" disabled={index === 0} onClick={() => movePrompt(index, -1)} />
                    <Button type="text" icon={<ArrowDown size={16} />} aria-label={`下移猜你想问 ${index + 1}`} title="下移" disabled={index === config.prompts.length - 1} onClick={() => movePrompt(index, 1)} />
                  </Space>
                  <Button danger type="text" icon={<Trash2 size={16} />} aria-label={`删除猜你想问 ${index + 1}`} disabled={config.prompts.length <= 1} onClick={() => setConfig((current) => ({ ...current, prompts: current.prompts.filter((_, itemIndex) => itemIndex !== index) }))} />
                </Space>
                <Input.TextArea maxLength={80} showCount rows={2} value={item.text} placeholder="用户点击后发送的完整问题" onChange={(event) => updatePrompt(index, { text: event.target.value })} />
              </Space>
            </Card>)}
            {config.prompts.length < 3 && <Button icon={<Plus size={16} />} onClick={() => setConfig((current) => ({ ...current, prompts: [...current.prompts, { title: '', text: '' }] }))}>添加问题</Button>}
          </Space>
        </div>
        <Card size="small" title="本地预览" className="w-full">
          <Space direction="vertical" size={12} className="w-full">
            <Typography.Text type="secondary">仅展示当前编辑内容，保存后才会更新公共入口。</Typography.Text>
            <Card size="small" bordered>
              <Space direction="vertical" size={12} className="w-full">
                <Space><Bot size={17} /><Typography.Text strong>小K</Typography.Text><Tag>草稿预览</Tag></Space>
                <Typography.Paragraph style={{ marginBottom: 0 }}>{config.opening.trim() || '请填写开场白'}</Typography.Paragraph>
                <Space wrap>
                  {config.prompts.map((item, index) => <Button key={`${index}-${item.title}`} size="small">{item.title.trim() || `问题 ${index + 1}`}</Button>)}
                </Space>
              </Space>
            </Card>
          </Space>
        </Card>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void save()}>保存并发布</Button>
          <Button disabled={saving} onClick={() => setConfig((current) => cloneDefault(current.version))}>恢复默认</Button>
        </Space>
      </Space>
    </Card>
  </PageContainer></div>;
}
