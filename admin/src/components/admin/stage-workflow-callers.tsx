'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Typography } from 'antd';
import { assistantError, assistantRequest } from '@/components/assistant/client';
import { stageDefinition } from '@/lib/xiaok-v1/stages';
import type { StageAgentSettings } from '@/lib/xiaok-v1/stage-workflow-settings';

export function useStageCallers(enabled: boolean) {
  const [settings, setSettings] = useState<StageAgentSettings>();
  const [error, setError] = useState('');
  const [attempt, reload] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    assistantRequest<StageAgentSettings>('stage-agents', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSettings(data);
          setError('');
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(assistantError(reason));
      });
    return () => controller.abort();
  }, [enabled, attempt]);
  return { settings, error, retry: () => reload((value) => value + 1) };
}

export function StageWorkflowCallers({ id, source }: { id: string; source: ReturnType<typeof useStageCallers> }) {
  if (source.error)
    return (
      <Typography.Text type="secondary">
        {source.error}{' '}
        <Button type="link" size="small" onClick={source.retry}>
          重试
        </Button>
      </Typography.Text>
    );
  if (!source.settings) return <Typography.Text type="secondary">正在读取当前企业…</Typography.Text>;
  const callers = source.settings.agents.flatMap((agent) =>
    agent.workflows
      .filter((ref) => ref.definitionId === id)
      .map((ref) => ({ stage: agent.stageId, revision: ref.revision, enabled: agent.enabled })),
  );
  return (
    <div className="nw-callers">
      {callers.length ? (
        callers.map((item) => (
          <Link
            key={item.stage}
            href={'/assistant-knowledge?tab=stage-agents&stage=' + item.stage + '&section=experience'}
          >
            {stageDefinition(item.stage)?.name} · v{item.revision}
            {item.enabled ? '' : '（停用）'}
          </Link>
        ))
      ) : (
        <Typography.Text type="secondary">当前企业暂无阶段绑定</Typography.Text>
      )}
    </div>
  );
}
