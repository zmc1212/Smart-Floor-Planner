'use client';

/*
 * THESIS: One operational switch for the assistant Worker, with the pilot
 * scope it may deliver to kept visible next to it.
 * OWN-WORLD: Existing green Admin tokens, white panels, restrained status color.
 * STORY: Pick the pilot enterprise and pilot id, save its project scope, then
 * start or stop the Worker. Every save appends an audited version; the Worker
 * picks it up on its next tick without a container restart.
 * FIRST VIEWPORT: The switch and scope own the wide left column; effective
 * state (gate, source, heartbeat, audit) stays visible at right.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Divider, Empty, Flex, Input, Result,
  Select, Skeleton, Space, Switch, Tag, Typography,
} from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { PlayCircle, RefreshCw, Save } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

type Gate = {
  status: 'open' | 'closed';
  reason: string;
  deliveryScope: string;
  mode: 'enterprise' | 'pilot' | null;
  enterpriseId: string | null;
  pilotId: string | null;
  errorCode: string | null;
};

type Config = {
  version: number;
  enabled: boolean;
  enterpriseId: string | null;
  pilotId: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

type Scope = {
  scopeVersion: number;
  status: 'active' | 'inactive';
  projectIds: string[];
};

type Project = { id: string; name: string; status: string; currentStageKey: string | null };

type EnterpriseOption = { _id: string; name: string; status: string };

type Snapshot = {
  deployment: { source: 'database' | 'environment'; config: Config | null; gate: Gate };
  enterprise: { id: string; name: string; status: string } | null;
  scope: Scope | null;
  projects: Project[] | null;
  worker: { freshness: string; lastSuccessAt: string; ageSeconds: string };
};

const GATE_REASON_LABELS: Record<string, string> = {
  pilot_scope_configured: '已启用，试点范围已配置',
  worker_disabled: '已由后台关闭',
  pilot_scope_missing: '未配置试点范围',
  pilot_worker_alignment: '提醒与周报配置不一致',
  enterprise_scope_not_allowed: '不允许企业全域运行',
};

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(40_000) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '请求失败');
  return result.data;
}

export default function AssistantWorkerPage() {
  const { user } = useCurrentUser();
  const canManage = user?.role === 'super_admin';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [pilotId, setPilotId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [loadedScope, setLoadedScope] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([]);

  const apply = useCallback((next: Snapshot) => {
    setSnapshot(next);
    const config = next.deployment.config;
    const gate = next.deployment.gate;
    setEnterpriseId(config?.enterpriseId ?? (gate.mode === 'pilot' ? gate.enterpriseId ?? '' : ''));
    setPilotId(config?.pilotId ?? (gate.mode === 'pilot' ? gate.pilotId ?? '' : ''));
    setEnabled(config?.enabled ?? gate.status === 'open');
    const projectIds = next.scope?.projectIds ?? [];
    setSelectedProjects(projectIds);
    setLoadedScope(projectIds);
  }, []);

  const load = useCallback(async (targetEnterprise = '', targetPilot = '') => {
    if (!canManage) return;
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (targetEnterprise) query.set('enterpriseId', targetEnterprise);
      if (targetPilot) query.set('pilotId', targetPilot);
      const queryString = query.toString();
      apply(await requestJson(`/api/platform/assistant-worker${queryString ? `?${queryString}` : ''}`));
      setLoadError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 Worker 配置失败';
      setLoadError(message);
      notify.error(message);
    } finally {
      setLoading(false);
    }
  }, [apply, canManage]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canManage) return;
    requestJson('/api/admin/enterprises')
      .then((list: EnterpriseOption[]) => setEnterprises(Array.isArray(list) ? list : []))
      .catch(() => setEnterprises([]));
  }, [canManage]);

  const enterpriseOptions = useMemo(() => {
    const active = enterprises.filter(item => item.status === 'active')
      .map(item => ({ value: item._id, label: `${item.name}（#${item._id}）` }));
    if (enterpriseId && !active.some(item => item.value === enterpriseId)) {
      active.unshift({ value: enterpriseId, label: `#${enterpriseId}（不在启用企业列表）` });
    }
    return active;
  }, [enterpriseId, enterprises]);

  const gate = snapshot?.deployment.gate;
  const config = snapshot?.deployment.config;
  const projects = snapshot?.projects ?? null;
  const scopeDirty = useMemo(
    () => selectedProjects.length !== loadedScope.length
      || selectedProjects.some((projectId, index) => projectId !== loadedScope[index]),
    [loadedScope, selectedProjects],
  );
  const dirty = config
    ? enabled !== config.enabled || enterpriseId !== (config.enterpriseId ?? '')
      || pilotId !== (config.pilotId ?? '') || scopeDirty
    : true;

  const refresh = async () => {
    if (!enterpriseId.trim() || !pilotId.trim()) {
      notify.warning('请先填写企业 ID 与试点 ID');
      return;
    }
    await load(enterpriseId.trim(), pilotId.trim());
  };

  const save = async () => {
    if (!snapshot) return;
    if (enabled && (!enterpriseId.trim() || !pilotId.trim())) {
      notify.warning('启用前必须填写企业 ID 与试点 ID');
      return;
    }
    if (enabled && selectedProjects.length === 0) {
      notify.warning('启用前至少选择一个试点项目');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled,
        enterpriseId: enterpriseId.trim() || null,
        pilotId: pilotId.trim() || null,
        expectedVersion: config?.version ?? 0,
      };
      if (scopeDirty && selectedProjects.length > 0) {
        body.projectIds = selectedProjects;
        body.expectedScopeVersion = snapshot.scope?.scopeVersion ?? 0;
      }
      apply(await requestJson('/api/platform/assistant-worker', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      notify.success(enabled ? 'Worker 已启用，下一次心跳生效' : 'Worker 已关闭，下一次心跳停止业务任务');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存 Worker 配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (user && !canManage) {
    return <Result status="403" title="无权访问" subTitle="仅平台超级管理员可以启停小 K Worker 并配置试点范围。" />;
  }
  if (loadError && !loading) {
    return <Alert showIcon type="error" message="读取配置失败" description={loadError}
      action={<Button onClick={() => void load()}>重试</Button>} />;
  }

  const gateColor = gate?.status === 'open' ? 'success'
    : gate?.reason === 'worker_disabled' ? 'default' : 'warning';

  return (
    <div className="admin-page-frame">
      <PageContainer breadcrumbRender={false} className="admin-page-container"
        title={<Space size={12}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><PlayCircle size={21} /></span>小 K Worker 启停</Space>}
        subTitle="后台开关代替命令行；保存后 Worker 在下一次心跳自动生效">
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="admin-panel-card" loading={loading}>
            <Flex vertical gap={20}>
              <Flex align="center" justify="space-between" gap={20}>
                <div>
                  <Typography.Text strong>启用 Assistant Worker</Typography.Text>
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-1">
                    关闭后 Worker 进程保持常驻，但不会生成提醒、周报或执行任何业务写入。
                  </Typography.Paragraph>
                </div>
                <Switch checked={enabled} onChange={setEnabled} disabled={saving} aria-label="启用 Assistant Worker" />
              </Flex>

              <Divider className="!my-0" />

              <div>
                <Typography.Text strong>试点企业</Typography.Text>
                <Select className="mt-2 w-full" value={enterpriseId || undefined}
                  showSearch optionFilterProp="label" disabled={saving}
                  options={enterpriseOptions} placeholder="选择企业"
                  onChange={value => setEnterpriseId(value)} aria-label="试点企业" />
              </div>
              <div>
                <Typography.Text strong>试点 ID</Typography.Text>
                <Input className="mt-2" value={pilotId} disabled={saving}
                  onChange={event => setPilotId(event.target.value.trim())}
                  placeholder="例如 first-pilot" aria-label="试点 ID" />
              </div>
              <Flex gap={12} wrap="wrap">
                <Button icon={<RefreshCw size={15} />} loading={loading} disabled={saving}
                  onClick={() => void refresh()}>加载企业与试点项目</Button>
                <Button type="primary" icon={<Save size={15} />} loading={saving} disabled={!dirty}
                  onClick={() => void save()}>保存并生效</Button>
              </Flex>

              <Divider className="!my-0" />

              <div>
                <Flex align="center" justify="space-between" gap={12} wrap="wrap">
                  <Typography.Text strong>试点项目范围</Typography.Text>
                  <Typography.Text type="secondary" className="!text-xs">
                    {snapshot?.scope
                      ? `当前版本 v${snapshot.scope.scopeVersion} · ${snapshot.scope.status === 'active' ? '生效中' : '已停用'}`
                      : '尚未保存试点范围'}
                  </Typography.Text>
                </Flex>
                <div className="mt-3">
                  {projects === null ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="填写企业 ID 与试点 ID 后点击“加载企业与试点项目”" />
                  ) : projects.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该企业没有可纳入试点的 active 项目" />
                  ) : (
                    <Flex vertical gap={10}>
                      {projects.map(project => (
                        <Checkbox key={project.id} checked={selectedProjects.includes(project.id)}
                          disabled={saving}
                          onChange={event => {
                            const checked = event.target.checked;
                            setSelectedProjects(current => checked
                              ? [...current, project.id]
                              : current.filter(projectId => projectId !== project.id));
                          }}>
                          <Space size={8} wrap>
                            <span>{project.name}</span>
                            <Tag className="!m-0">#{project.id}</Tag>
                            <Tag className="!m-0" color={project.currentStageKey ? 'processing' : 'warning'}>
                              {project.currentStageKey || '未设阶段'}
                            </Tag>
                          </Space>
                        </Checkbox>
                      ))}
                    </Flex>
                  )}
                </div>
              </div>

              {snapshot && snapshot.deployment.source === 'environment' ? (
                <Alert showIcon type="info" message="当前仍由部署环境变量提供试点配置"
                  description="首次保存后以数据库版本为准。随后建议清空 .env.production 中的 XIAOK_* 试点变量，仅保留数据库配置。" />
              ) : null}
            </Flex>
          </Card>

          <Card className="admin-panel-card h-full">
            {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
              <Flex vertical gap={20}>
                <div>
                  <Typography.Title level={5} className="!mb-3">当前生效状态</Typography.Title>
                  <Tag color={gateColor} className="!m-0">
                    {gate ? GATE_REASON_LABELS[gate.reason] ?? gate.reason : '未知'}
                  </Tag>
                  <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 !text-xs">
                    配置来源：{snapshot?.deployment.source === 'database' ? '后台数据库版本' : '部署环境变量'}
                  </Typography.Paragraph>
                </div>

                <Divider className="!my-0" />

                <Space direction="vertical" size={16} className="w-full">
                  <div>
                    <Typography.Text type="secondary">试点企业</Typography.Text>
                    <Typography.Paragraph className="!mb-0 !mt-1">
                      {snapshot?.enterprise ? `${snapshot.enterprise.name}（#${snapshot.enterprise.id}）` : enterpriseId || '未填写'}
                    </Typography.Paragraph>
                  </div>
                  <div>
                    <Typography.Text type="secondary">试点 ID</Typography.Text>
                    <Typography.Paragraph className="!mb-0 !mt-1 break-all font-mono !text-xs">
                      {pilotId || '未填写'}
                    </Typography.Paragraph>
                  </div>
                  <div>
                    <Typography.Text type="secondary">Worker 心跳</Typography.Text>
                    <Typography.Paragraph className="!mb-0 !mt-1">
                      {snapshot?.worker.freshness === 'fresh'
                        ? `正常 · ${snapshot.worker.ageSeconds} 秒前`
                        : snapshot?.worker.freshness === 'stale'
                          ? `延迟 · ${snapshot.worker.ageSeconds} 秒前`
                          : '无可用心跳（检查 assistant-worker 容器）'}
                    </Typography.Paragraph>
                  </div>
                  <div>
                    <Typography.Text type="secondary">最近一次配置变更</Typography.Text>
                    <Typography.Paragraph className="!mb-0 !mt-1">
                      {config
                        ? `v${config.version} · ${new Date(config.updatedAt).toLocaleString('zh-CN', { hour12: false })} · 管理员 #${config.updatedBy ?? '未知'}`
                        : '尚未在后台保存过'}
                    </Typography.Paragraph>
                  </div>
                </Space>

                <Alert showIcon type="warning" message="安全边界保持不变"
                  description="启用只开放已保存的试点范围；试点范围为空、停用或未配置时，Worker 仍不会生成或投递任何提醒与周报。" />
              </Flex>
            )}
          </Card>
        </div>
      </PageContainer>
    </div>
  );
}
