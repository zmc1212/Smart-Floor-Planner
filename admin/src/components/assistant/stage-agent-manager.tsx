'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Modal, Segmented, Select, Skeleton, Space, Tag } from 'antd';
import { Bot, ChevronDown, History, Workflow } from 'lucide-react';
import { stageDefinition, stageDefinitions, type StageId } from '@/lib/xiaok-v1/stages';
import type { EnterpriseStageAgent, StageAgentSettings } from '@/lib/xiaok-v1/stage-workflow-settings';
import { stageExperienceSchema } from '@/lib/xiaok-v1/stage-experience';
import { notify } from '@/components/admin/operation-feedback';
import { assistantError, assistantRequest, formatTime } from './client';
import { draftIssue, makeDraft, stagePayload, StageStudioFields, type StudioDraft } from './stage-studio-fields';
import { StageStudioChat } from './stage-studio-chat';
import { StageWechatChannel } from './stage-wechat-channel';
import './stage-studio.css';

export function StageAgentManager({ canPublish }: { canPublish: boolean }) {
  const [settings, setSettings] = useState<StageAgentSettings>(),
    [drafts, setDrafts] = useState<Partial<Record<StageId, StudioDraft>>>({});
  const [stage, setStage] = useState<StageId>(() => {
    const key = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('stage');
    return stageDefinition(key || '')?.stageId ?? 'utilities';
  });
  const [visitedStages, setVisitedStages] = useState<StageId[]>([stage]);
  const [tab, setTab] = useState('应用配置'),
    [mobile, setMobile] = useState('配置面板'),
    [history, setHistory] = useState(false);
  const [revision, reload] = useState(0),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const ac = new AbortController();
    void assistantRequest<StageAgentSettings>('stage-agents', { signal: ac.signal })
      .then((v) => {
        if (!ac.signal.aborted) {
          setSettings(v);
          setError('');
        }
      })
      .catch((err) => {
        if (!ac.signal.aborted) setError(assistantError(err));
      });
    return () => ac.abort();
  }, [revision]);
  const saved = settings?.agents.find((a) => a.stageId === stage),
    draft = saved ? (drafts[stage] ?? makeDraft(saved)) : null;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(makeDraft(saved));
  const initialSection =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('section') : null;
  const loadedEnterprise = settings?.enterpriseId;
  useEffect(() => {
    if (loadedEnterprise && initialSection === 'experience' && tab === '应用配置') {
      const t = requestAnimationFrame(() => {
        const pane = document.querySelector('.ss-settings'),
          section = document.getElementById('ss-experience');
        if (pane && section)
          pane.scrollTop += section.getBoundingClientRect().top - pane.getBoundingClientRect().top - 48;
      });
      return () => cancelAnimationFrame(t);
    }
  }, [loadedEnterprise, initialSection, stage, tab]);
  function choose(key: StageId) {
    setStage(key);
    setVisitedStages((current) => (current.includes(key) ? current : [...current, key]));
    setTab('应用配置');
    setMobile('配置面板');
    setError('');
    const url = new URL(window.location.href);
    url.searchParams.set('stage', key);
    url.searchParams.set('tab', 'stage-agents');
    url.searchParams.delete('section');
    window.history.replaceState(null, '', url);
  }
  async function save() {
    if (!settings || !draft || lock.current) return;
    const problem = draftIssue(draft);
    const valid = stageExperienceSchema.safeParse(draft.experience);
    if (problem || !valid.success) {
      setError(problem || valid.error?.issues[0]?.message || '请检查配置');
      setTab('应用配置');
      setMobile('配置面板');
      return;
    }
    const submitted = stage;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const value = await assistantRequest<EnterpriseStageAgent>('stage-agents', {
        method: draft.version ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stagePayload(draft, settings.enterpriseId)),
      });
      setSettings(
        (s) => s && { ...s, agents: s.agents.map((item) => (item.stageId === submitted ? value : item)) },
      );
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[submitted];
        return copy;
      });
      notify.success(
        draft.version ? '已保存阶段配置' : value.enabled ? '已创建并启用阶段 Agent' : '已创建阶段 Agent',
      );
    } catch (err) {
      setError(assistantError(err));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  function fresh() {
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[stage];
      return copy;
    });
    reload((n) => n + 1);
  }
  if (!settings || !saved || !draft)
    return error ? (
      <Alert type="error" message={error} action={<Button onClick={fresh}>重新读取</Button>} />
    ) : (
      <Skeleton active />
    );
  return (
    <div className="stage-studio">
      <header className="ss-top">
        <div className="ss-stage">
          <Bot size={18} />
          <Select
            aria-label="装修阶段"
            value={stage}
            disabled={saving}
            popupMatchSelectWidth={205}
            options={stageDefinitions.map((s) => {
              const a = settings.agents.find((v) => v.stageId === s.stageId);
              return {
                value: s.stageId,
                label: s.name + '阶段 · ' + (a?.version ? (a.enabled ? '已启用' : '已停用') : '系统默认'),
              };
            })}
            onChange={choose}
          />
        </div>
        <Segmented
          aria-label="阶段应用"
          options={['应用配置', '发布渠道', '对话日志']}
          value={tab}
          onChange={(v) => setTab(String(v))}
        />
        <Space size={7}>
          {canPublish && (
            <Button
              type="text"
              href="/native-workflow"
              title="工作流模板"
              aria-label="工作流模板"
              icon={<Workflow size={16} />}
            />
          )}
          <span className="ss-state">{dirty ? '有未保存修改' : saved.version ? '已保存' : '系统默认'}</span>
          <Button
            title="编辑历史"
            aria-label="编辑历史"
            icon={<History size={16} />}
            onClick={() => setHistory(true)}
          />
          <Space.Compact>
            <Button
              type="primary"
              loading={saving}
              disabled={!dirty}
              onClick={() => void save()}
            >
              保存
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'history', label: '编辑历史' },
                  { key: 'channel', label: '查看发布渠道' },
                ],
                onClick: ({ key }) => (key === 'history' ? setHistory(true) : setTab('发布渠道')),
              }}
            >
              <Button type="primary" aria-label="更多保存选项" icon={<ChevronDown size={13} />} />
            </Dropdown>
          </Space.Compact>
        </Space>
      </header>
      {error && (
        <Alert type="error" showIcon message={error} action={<Button onClick={fresh}>读取最新配置</Button>} />
      )}
      <div className="ss-mobile" hidden={tab !== '应用配置'}>
        <Segmented value={mobile} options={['配置面板', '调试预览']} onChange={(v) => setMobile(String(v))} />
      </div>
      {tab === '发布渠道' && (
        <section className="ss-other">
          <h2>发布渠道</h2>
          <h3>业主小程序 · 我的工地</h3>
          <Tag color={saved.enabled ? 'green' : undefined}>{saved.enabled ? '已启用' : '使用系统默认助手'}</Tag>
          <p>
            {stageDefinition(stage)?.name}阶段{saved.version ? ' · 最近保存 v' + saved.version : ''}
          </p>
          <StageWechatChannel key={settings.enterpriseId + ':' + stage} enterprise={settings.enterpriseId} stage={stage} enabled={saved.enabled} />
        </section>
      )}
      <div
        className={'ss-split ' + (tab === '对话日志' ? 'is-logs' : '')}
        data-pane={mobile}
        hidden={tab === '发布渠道'}
      >
        {tab === '应用配置' && (
          <StageStudioFields
            key={stage}
            initialSection={initialSection || undefined}
            draft={draft}
            templates={settings.templates}
            canPublish={canPublish}
            model={settings.model}
            change={(a) => {
              if (!lock.current) {
                setDrafts((d) => ({ ...d, [stage]: a }));
                setError('');
              }
            }}
          />
        )}
        {visitedStages.map((id) => {
          const agent = settings.agents.find((a) => a.stageId === id);
          if (!agent) return null;
          return (
            <div key={settings.enterpriseId + ':' + id} className="ss-chat-host" hidden={id !== stage}>
              <StageStudioChat
                draft={id === stage ? draft : (drafts[id] ?? makeDraft(agent))}
                enterpriseId={settings.enterpriseId}
                logs={tab === '对话日志' && id === stage}
                active={id === stage && tab !== '发布渠道'}
              />
            </div>
          );
        })}
      </div>
      <Modal title="编辑历史" open={history} footer={null} onCancel={() => setHistory(false)}>
        {saved.history?.length ? (
          saved.history.map((h) => (
            <p key={h.version}>
              <b>
                v{h.version}　{h.name}
              </b>{' '}
              · {h.enabled ? '已启用' : '已停用'}
              <br />
              <small>{formatTime(h.at)}</small>
            </p>
          ))
        ) : (
          <p>本阶段暂无编辑记录。</p>
        )}
      </Modal>
    </div>
  );
}
