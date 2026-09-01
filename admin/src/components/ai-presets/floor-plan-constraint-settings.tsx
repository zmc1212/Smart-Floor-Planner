'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

type AiPromptConfigDto = {
  floorPlanConstraintPrompt: string;
  defaultFloorPlanConstraintPrompt: string;
  isDefault: boolean;
};

export function FloorPlanConstraintSettings() {
  const [config, setConfig] = useState<AiPromptConfigDto | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const dirty = useMemo(
    () => Boolean(config && prompt.trim() !== config.floorPlanConstraintPrompt),
    [config, prompt]
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/platform/ai-prompt-config');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取 AI 内置提示词失败');
      }
      setConfig(result.data);
      setPrompt(result.data.floorPlanConstraintPrompt);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : '读取 AI 内置提示词失败';
      setLoadError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const save = async () => {
    if (!prompt.trim()) {
      notify.warning('户型结构约束提示词不能为空');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/platform/ai-prompt-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floorPlanConstraintPrompt: prompt }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存 AI 内置提示词失败');
      }
      setConfig(result.data);
      setPrompt(result.data.floorPlanConstraintPrompt);
      notify.success('户型结构约束已保存，将从下一次正式户型出图开始生效');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存 AI 内置提示词失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className="admin-panel-card"
      loading={loading}
      title={(
        <Space size={10}>
          <ShieldCheck size={18} />
          <span>正式户型结构约束</span>
          <Tag color="green">自动注入</Tag>
        </Space>
      )}
    >
      <Space direction="vertical" size={16} className="w-full">
        {loadError ? (
          <Alert
            showIcon
            type="error"
            message="暂时无法读取配置"
            description={loadError}
            action={(
              <Button size="small" onClick={() => void loadConfig()}>
                重新加载
              </Button>
            )}
          />
        ) : null}
        <Alert
          showIcon
          type="info"
          message="只约束绑定正式户型控制图的生成"
          description="系统会把这段文字放在用户输入和提示词模板之前。第一张参考图只负责户型结构；现场图负责相机视角与构图；只有明确要求俯视图时才使用户型图视角。普通自由创作不会注入。"
        />
        <div>
          <Typography.Paragraph strong className="!mb-1">
            平台内置提示词
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" className="!mb-3">
            建议保留参考图角色、结构优先级、现场图视角和非俯视默认规则。可随时整体替换，保存后只影响新创建的生成任务。
          </Typography.Paragraph>
          <TextArea
            aria-label="正式户型结构约束提示词"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            autoSize={{ minRows: 12, maxRows: 20 }}
            maxLength={6000}
            showCount
            disabled={Boolean(loadError)}
          />
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<Save size={16} />}
            loading={saving}
            disabled={!dirty || Boolean(loadError)}
            onClick={() => void save()}
          >
            保存并用于后续生成
          </Button>
          <Button
            icon={<RotateCcw size={16} />}
            disabled={!config || Boolean(loadError)}
            onClick={() => {
              if (!config) return;
              setPrompt(config.defaultFloorPlanConstraintPrompt);
            }}
          >
            载入默认文案
          </Button>
          {dirty ? (
            <Typography.Text type="warning">有未保存更改</Typography.Text>
          ) : null}
          {config ? (
            <Typography.Text type="secondary">
              当前已保存：{config.isDefault ? '平台默认文案' : '自定义文案'}
            </Typography.Text>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
