'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

type AiPromptConfigDto = {
  floorPlanConstraintPrompt: string;
  defaultFloorPlanConstraintPrompt: string;
  singleRoomFullSpacePrompt: string;
  defaultSingleRoomFullSpacePrompt: string;
  softFurnishingOnlyPrompt: string;
  defaultSoftFurnishingOnlyPrompt: string;
  isDefault: boolean;
  isSingleRoomFullSpaceDefault: boolean;
  isSoftFurnishingOnlyDefault: boolean;
};

export function FloorPlanConstraintSettings() {
  const [config, setConfig] = useState<AiPromptConfigDto | null>(null);
  const [prompt, setPrompt] = useState('');
  const [fullSpacePrompt, setFullSpacePrompt] = useState('');
  const [softFurnishingPrompt, setSoftFurnishingPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const dirty = useMemo(
    () => Boolean(config && (
      prompt.trim() !== config.floorPlanConstraintPrompt
      || fullSpacePrompt.trim() !== config.singleRoomFullSpacePrompt
      || softFurnishingPrompt.trim() !== config.softFurnishingOnlyPrompt
    )),
    [config, fullSpacePrompt, prompt, softFurnishingPrompt]
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
      setFullSpacePrompt(result.data.singleRoomFullSpacePrompt);
      setSoftFurnishingPrompt(result.data.softFurnishingOnlyPrompt);
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
    if (!prompt.trim() || !fullSpacePrompt.trim() || !softFurnishingPrompt.trim()) {
      notify.warning('三个 AI 结构提示词均不能为空');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/platform/ai-prompt-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          floorPlanConstraintPrompt: prompt,
          singleRoomFullSpacePrompt: fullSpacePrompt,
          softFurnishingOnlyPrompt: softFurnishingPrompt,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存 AI 内置提示词失败');
      }
      setConfig(result.data);
      setPrompt(result.data.floorPlanConstraintPrompt);
      setFullSpacePrompt(result.data.singleRoomFullSpacePrompt);
      setSoftFurnishingPrompt(result.data.softFurnishingOnlyPrompt);
      notify.success('AI 结构提示词已保存，将从下一次出图开始生效');
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
          <span>AI 结构提示词</span>
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
            message="按设计模式自动注入"
            description="正式户型约束用于整屋设计；单间全空间设计允许调整硬装；仅软装换搭锁定硬装，只允许更换可移动软装。系统会把对应文案放在用户输入之前，普通自由创作不会注入户型约束。"
        />
        <div>
          <Typography.Paragraph strong className="!mb-1">
            平台内置提示词
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" className="!mb-3">
            三段文案分别独立生效，可随时替换；保存后只影响新创建的生成任务。
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
        <div>
          <Typography.Paragraph strong className="!mb-1">
            单间全空间设计提示词
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" className="!mb-3">
            保留现场图镜头和建筑结构，允许调整墙顶地、固定柜体、灯光、家具与装饰。
          </Typography.Paragraph>
          <TextArea
            aria-label="单间全空间设计提示词"
            value={fullSpacePrompt}
            onChange={(event) => setFullSpacePrompt(event.target.value)}
            autoSize={{ minRows: 8, maxRows: 16 }}
            maxLength={6000}
            showCount
            disabled={Boolean(loadError)}
          />
        </div>
        <div>
          <Typography.Paragraph strong className="!mb-1">
            单间仅软装换搭提示词
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" className="!mb-3">
            锁定墙顶地、固定柜体、厨卫设施和建筑照明，只允许调整可移动软装。
          </Typography.Paragraph>
          <TextArea
            aria-label="单间仅软装换搭提示词"
            value={softFurnishingPrompt}
            onChange={(event) => setSoftFurnishingPrompt(event.target.value)}
            autoSize={{ minRows: 8, maxRows: 16 }}
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
              setFullSpacePrompt(config.defaultSingleRoomFullSpacePrompt);
              setSoftFurnishingPrompt(config.defaultSoftFurnishingOnlyPrompt);
            }}
          >
            载入默认文案
          </Button>
          {dirty ? (
            <Typography.Text type="warning">有未保存更改</Typography.Text>
          ) : null}
          {config ? (
            <Typography.Text type="secondary">
              当前已保存：{config.isDefault && config.isSingleRoomFullSpaceDefault && config.isSoftFurnishingOnlyDefault ? '平台默认文案' : '自定义文案'}
            </Typography.Text>
          ) : null}
        </Space>
      </Space>
    </Card>
  );
}
