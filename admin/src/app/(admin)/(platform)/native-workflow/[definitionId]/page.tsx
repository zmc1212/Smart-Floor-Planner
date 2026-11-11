'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageContainer } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Popconfirm,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { SimulationResult, WorkflowTraceEntry } from '@/lib/native-workflow';
import {
  applySaveConflict,
  applySaveSuccess,
  createDraftEditorState,
  isDraftDirty,
  keepLocalAndRebase,
  updateDraftText,
  type DraftEditorState,
} from '@/lib/native-workflow/admin-draft-state';
import {
  fixtureSetsForSchema,
  resolveFixtureSetId,
  selectedSimulationDefinition,
} from '@/lib/native-workflow/admin-selection';
import {
  createPeriodRunStatusController,
  formatPeriodRunState,
  INITIAL_PERIOD_RUN_STATUS_STATE,
  PERIOD_RUN_POLL_INTERVAL_MS,
  PERIOD_RUN_POLL_MAX_READS,
  type PeriodRunObservationResult,
  type PeriodRunStatusController,
  type PeriodRunStatusControllerState,
} from '@/lib/native-workflow/admin-run-status';
import type { PeriodReportRunObservation } from '@/lib/native-workflow/live/period-report-status';
import type { PublishedWorkflowVersion, WorkflowDefinitionRecord } from '@/lib/native-workflow/store/types';
import type { WorkflowFixtureSetSummary } from '@/lib/native-workflow/fixtures/catalog';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface DefinitionIssue {
  code: string;
  path: string;
  message: string;
}

interface DetailResponse {
  record: WorkflowDefinitionRecord;
  fixtureSets: readonly WorkflowFixtureSetSummary[];
}

interface SimulationResponse {
  source: 'draft' | 'published';
  revision: number;
  simulation: SimulationResult;
}

const codeBlockStyle = {
  margin: 0,
  padding: 12,
  background: '#fafafa',
  borderRadius: 6,
  maxHeight: 320,
  overflow: 'auto',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  lineHeight: 1.6,
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  queued: '排队中',
  waiting: '等待中',
  running: '处理中',
  ready: '就绪',
  succeeded: '成功',
  delivered: '已投递',
  revoked: '已撤回',
  muted: '已静音',
  available: '可用',
  access_revoked: '权限已撤销',
  source_unavailable: '数据源不可用',
  completed: '已完成',
  stopped: '已停止投递',
  halted: '已停止',
  failed: '失败',
  unknown: '未知',
  unavailable: '不可用',
};

function stateLabel(value: string | null | undefined): string {
  if (!value) return '未知';
  return STATE_LABELS[value] ?? value;
}

const GREEN_STATES = new Set(['ready', 'succeeded', 'delivered', 'available', 'completed']);
const RED_STATES = new Set(['failed', 'access_revoked']);
const BLUE_STATES = new Set(['running', 'processing']);
const ORANGE_STATES = new Set(['unknown', 'unavailable', 'revoked', 'muted', 'halted', 'stopped', 'source_unavailable']);

function stateColor(value: string | null | undefined): string {
  if (!value) return 'default';
  if (GREEN_STATES.has(value)) return 'green';
  if (RED_STATES.has(value)) return 'red';
  if (BLUE_STATES.has(value)) return 'blue';
  if (ORANGE_STATES.has(value)) return 'orange';
  return 'default';
}

export default function NativeWorkflowDetailPage() {
  return (
    <Suspense
      fallback={
        <PageContainer header={{ title: '原生编排调试' }}>
          <Spin />
        </PageContainer>
      }
    >
      <NativeWorkflowDetailPageInner />
    </Suspense>
  );
}

function NativeWorkflowDetailPageInner() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.definitionId;
  const definitionId = Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '';
  const { user } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [editor, setEditor] = useState<DraftEditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issues, setIssues] = useState<DefinitionIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [fixtureSetId, setFixtureSetId] = useState('');
  const [simSource, setSimSource] = useState<'draft' | 'published'>('draft');
  const [simRevision, setSimRevision] = useState<number | undefined>(undefined);
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const urlRunId = (searchParams?.get('runId') ?? '').trim();
  const [runIdInput, setRunIdInput] = useState(urlRunId);
  const [activeTab, setActiveTab] = useState('draft');
  const [runStatus, setRunStatus] = useState<PeriodRunStatusControllerState>(INITIAL_PERIOD_RUN_STATUS_STATE);
  const runController = useRef<PeriodRunStatusController | null>(null);

  const fetchRunObservation = useCallback(async (runId: string): Promise<PeriodRunObservationResult> => {
    try {
      const response = await fetch(
        `/api/native-workflow/runs/${encodeURIComponent(runId)}/period-report-status`,
        { cache: 'no-store' },
      );
      let body: {
        success?: boolean;
        data?: PeriodReportRunObservation;
        message?: string;
        error?: string;
      } | null = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || !body?.success || !body.data) {
        return {
          ok: false,
          status: response.status,
          message: String(body?.message || body?.error || `读取运行状态失败（HTTP ${response.status}）`),
        };
      }
      return { ok: true, observation: body.data };
    } catch (error) {
      return {
        ok: false,
        status: null,
        message: error instanceof Error ? error.message : '读取运行状态失败',
      };
    }
  }, []);

  useEffect(() => {
    const controller = createPeriodRunStatusController({
      fetchObservation: (runId) => fetchRunObservation(runId),
      onChange: setRunStatus,
    });
    runController.current = controller;
    return () => {
      controller.dispose();
      if (runController.current === controller) runController.current = null;
    };
  }, [fetchRunObservation]);

  useEffect(() => {
    const controller = runController.current;
    if (!controller) return;
    // A runId in the URL always owns the input, but it is only read while the
    // live tab is visible.
    if (urlRunId) setRunIdInput(urlRunId);
    if (activeTab !== 'live') {
      // Leaving the tab stops the timer and invalidates in-flight responses.
      controller.deactivate();
      return;
    }
    if (urlRunId && controller.getState().runId !== urlRunId) {
      controller.start(urlRunId);
      return;
    }
    // Returning only resumes a read that was cut short; a denial or a
    // transient failure stays stopped until the admin asks again.
    controller.activate();
  }, [activeTab, urlRunId]);

  const submitRunId = () => {
    const runId = runIdInput.trim();
    if (!runId) return;
    if (activeTab === 'live') runController.current?.start(runId);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (next.get('runId') === runId) return;
    next.set('runId', runId);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const load = useCallback(async (resetDraft = true): Promise<WorkflowDefinitionRecord | null> => {
    if (!definitionId) return null;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/native-workflow/definitions/${encodeURIComponent(definitionId)}`, {
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || result.error || '读取流程失败');
      const data = result.data as DetailResponse;
      setDetail(data);
      if (resetDraft) {
        setEditor(createDraftEditorState(formatJson(data.record.draft.definition), data.record.draft.draftRevision));
      }
      setSimRevision((current) => current ?? data.record.versions[data.record.versions.length - 1]?.revision);
      return data.record;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取流程失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSimulation = useMemo(
    () => (detail ? selectedSimulationDefinition(detail.record, simSource, simRevision) : null),
    [detail, simSource, simRevision],
  );

  const compatibleFixtures = useMemo(
    () => (detail && selectedSimulation ? fixtureSetsForSchema(selectedSimulation.definition.inputSchema, detail.fixtureSets) : []),
    [detail, selectedSimulation],
  );

  useEffect(() => {
    setFixtureSetId((current) => {
      const next = resolveFixtureSetId(compatibleFixtures, current);
      return next === current ? current : next;
    });
  }, [compatibleFixtures]);

  useEffect(() => {
    if (simSource !== 'published' || !detail) return;
    const latest = detail.record.versions[detail.record.versions.length - 1];
    if (!latest) return;
    setSimRevision((current) => (current === undefined ? latest.revision : current));
  }, [simSource, detail]);

  const saveDraft = async () => {
    if (!detail || !editor) return;
    const submittedText = editor.text;
    const expectedRevision = editor.baseRevision;
    let definition: unknown;
    try {
      definition = JSON.parse(submittedText);
    } catch {
      notify.error('草稿不是合法 JSON');
      return;
    }
    setSaving(true);
    setIssues([]);
    try {
      const response = await fetch(`/api/native-workflow/definitions/${encodeURIComponent(definitionId)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition, expectedDraftRevision: expectedRevision }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        if (response.status === 409) {
          const latest = await load(false);
          const remoteRevision =
            Number((body.details as { currentDraftRevision?: number } | undefined)?.currentDraftRevision)
            || latest?.draft.draftRevision
            || editor.serverRevision;
          setEditor((current) => (current ? applySaveConflict(current, remoteRevision) : current));
          return;
        }
        if (Array.isArray(body.issues)) {
          setIssues(body.issues as DefinitionIssue[]);
          return;
        }
        notify.error(String(body.message || body.error || '保存草稿失败'));
        return;
      }
      const saved = body.data as WorkflowDefinitionRecord;
      setDetail((current) => (current ? { ...current, record: saved } : current));
      setEditor((current) =>
        current ? applySaveSuccess(current, submittedText, formatJson(saved.draft.definition), saved.draft.draftRevision) : current,
      );
      notify.success('草稿已保存');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存草稿失败');
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    if (!detail) return;
    setPublishing(true);
    setIssues([]);
    try {
      const response = await fetch(`/api/native-workflow/definitions/${encodeURIComponent(definitionId)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedDraftRevision: detail.record.draft.draftRevision }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        if (response.status === 409) {
          notify.error('草稿已被其他操作更新，请先载入最新内容再发布');
          await load(false);
          return;
        }
        if (Array.isArray(body.issues)) {
          setIssues(body.issues as DefinitionIssue[]);
          return;
        }
        notify.error(String(body.message || body.error || '发布失败'));
        return;
      }
      const data = body.data as {
        record: WorkflowDefinitionRecord;
        version: PublishedWorkflowVersion;
        created: boolean;
      };
      setDetail((current) => (current ? { ...current, record: data.record } : current));
      notify.success(data.created ? `已发布 v${data.version.revision}` : `内容未变化，保持 v${data.version.revision}`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const resolveConflictKeepLocal = () => {
    setEditor((current) => {
      if (!current || current.conflictRevision === null) return current;
      return keepLocalAndRebase(current, current.conflictRevision);
    });
    notify.info('已基于远端最新草稿继续；下次保存会覆盖远端草稿');
  };

  const runSimulation = async (source = simSource, revision = simRevision) => {
    if (!detail) return;
    const selected = selectedSimulationDefinition(detail.record, source, revision);
    if (!selected) {
      notify.error('未找到对应的发布版本');
      return;
    }
    const compatible = fixtureSetsForSchema(selected.definition.inputSchema, detail.fixtureSets);
    const fixtureId = resolveFixtureSetId(compatible, fixtureSetId);
    if (!fixtureId) {
      notify.error('该版本没有匹配的 fixture');
      return;
    }
    if (fixtureId !== fixtureSetId) setFixtureSetId(fixtureId);
    setSimulating(true);
    setSimulation(null);
    try {
      const response = await fetch(`/api/native-workflow/definitions/${encodeURIComponent(definitionId)}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixtureSetId: fixtureId,
          source,
          revision: source === 'published' ? selected.revision : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) {
        if (Array.isArray(body.issues)) setIssues(body.issues as DefinitionIssue[]);
        notify.error(String(body.message || body.error || '模拟运行失败'));
        return;
      }
      setSimulation(body.data as SimulationResponse);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '模拟运行失败');
    } finally {
      setSimulating(false);
    }
  };

  if (!canManage) {
    return (
      <PageContainer header={{ title: '原生编排调试' }}>
        <Result status="403" title="仅平台管理员可访问" subTitle="该调试入口仅对 super_admin / admin 开放。" />
      </PageContainer>
    );
  }
  if (loading && !detail) {
    return (
      <PageContainer header={{ title: '原生编排调试' }}>
        <Spin />
      </PageContainer>
    );
  }
  if (loadError) {
    return (
      <PageContainer header={{ title: '原生编排调试' }}>
        <Result
          status="warning"
          title="无法读取流程"
          subTitle={loadError}
          extra={<Button onClick={() => void load()}>重试</Button>}
        />
      </PageContainer>
    );
  }
  if (!detail || !editor) return null;

  const { record } = detail;
  const latest = record.versions[record.versions.length - 1] ?? null;
  const schema = record.draft.definition.inputSchema;
  const eventLabel =
    schema.eventType === 'stage_changed'
      ? '实际阶段变化'
      : schema.periodKind === 'weekly'
        ? '周报计划'
        : '日报计划';
  const serverDraftText = formatJson(record.draft.definition);
  const dirty = isDraftDirty(editor, serverDraftText);
  const hasConflict = editor.conflictRevision !== null;
  const observation = runStatus.observation;
  const binding = observation?.binding ?? null;
  const progress = observation?.progress ?? null;
  const raw = observation?.raw ?? null;
  const progressProcessing = progress?.processing === true;

  const draftTab = (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        title="草稿定义"
        extra={
          <Space wrap>
            <Tag>编辑基准 r{editor.baseRevision}</Tag>
            <Tag>服务端 r{record.draft.draftRevision}</Tag>
            <Button
              onClick={() => setEditor(createDraftEditorState(serverDraftText, record.draft.draftRevision))}
            >
              重置
            </Button>
            <Button type="primary" loading={saving} disabled={hasConflict} onClick={() => void saveDraft()}>
              保存草稿
            </Button>
            <Button loading={publishing} disabled={dirty || hasConflict} onClick={() => void publishDraft()}>
              发布版本
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {hasConflict ? (
            <Alert
              type="warning"
              showIcon
              message={`草稿已被其他操作更新到 r${editor.conflictRevision}；你的编辑仍基于 r${editor.baseRevision}`}
              description="普通保存会继续冲突，不会把远端修订号静默绑定到本地旧全文。请选择载入最新内容，或明确保留本地内容继续。"
              action={
                <Space direction="vertical">
                  <Button size="small" onClick={() => void load(true)}>
                    载入最新内容
                  </Button>
                  <Popconfirm
                    title="保存将覆盖远端最新草稿"
                    okText="继续"
                    cancelText="取消"
                    onConfirm={resolveConflictKeepLocal}
                  >
                    <Button size="small" danger>
                      保留本地内容并继续
                    </Button>
                  </Popconfirm>
                </Space>
              }
            />
          ) : null}
          {dirty && !hasConflict ? (
            <Alert type="info" showIcon message="编辑器内容尚未保存；发布前需要先保存草稿。" />
          ) : null}
          {issues.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message="校验未通过"
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {issues.map((issue) => (
                    <li key={`${issue.path}:${issue.code}`}>
                      <Typography.Text code>{issue.path}</Typography.Text> {issue.message}（{issue.code}）
                    </li>
                  ))}
                </ul>
              }
            />
          ) : null}
          <Input.TextArea
            value={editor.text}
            onChange={(event) => setEditor((current) => (current ? updateDraftText(current, event.target.value) : current))}
            autoSize={{ minRows: 18, maxRows: 34 }}
            spellCheck={false}
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            保存使用 validateDefinition 与独立的 editingBaseRevision 乐观锁；保存成功后服务端返回内容不会覆盖请求期间继续输入的文字。发布会再次校验并 compileDefinition，生成不可变版本。
          </Typography.Paragraph>
        </Space>
      </Card>
      <Card title="定义摘要">
        <Descriptions
          size="small"
          column={3}
          items={[
            { key: 'id', label: '定义 ID', children: <Typography.Text code>{record.definitionId}</Typography.Text> },
            { key: 'event', label: '事件类型', children: eventLabel },
            { key: 'nodes', label: '节点数', children: record.draft.definition.nodes.length },
            { key: 'entry', label: '入口节点', children: <Typography.Text code>{record.draft.definition.entryNodeId}</Typography.Text> },
            { key: 'draft', label: '草稿版本', children: `r${record.draft.draftRevision}` },
            { key: 'published', label: '最新发布', children: latest ? `v${latest.revision}` : '未发布' },
          ]}
        />
      </Card>
    </Space>
  );

  const versionsTab = (
    <Card title="已发布版本（只读）">
      {record.versions.length === 0 ? (
        <Empty description="尚无发布版本" />
      ) : (
        <Table<PublishedWorkflowVersion>
          rowKey="revision"
          pagination={false}
          dataSource={[...record.versions].reverse()}
          columns={[
            {
              title: '版本',
              dataIndex: 'revision',
              width: 90,
              render: (value: number) => <Tag color="green">v{value}</Tag>,
            },
            {
              title: '内容摘要',
              dataIndex: 'digest',
              render: (value: string) => (
                <Typography.Text code style={{ fontSize: 12 }}>
                  {value.slice(0, 20)}…
                </Typography.Text>
              ),
            },
            { title: '发布时间', dataIndex: 'publishedAt', width: 200 },
            {
              title: '节点数',
              dataIndex: 'nodeVersions',
              width: 90,
              render: (value: Record<string, string>) => Object.keys(value).length,
            },
            {
              title: '操作',
              width: 150,
              render: (_value: unknown, version: PublishedWorkflowVersion) => (
                <Button
                  size="small"
                  onClick={() => {
                    setSimSource('published');
                    setSimRevision(version.revision);
                    void runSimulation('published', version.revision);
                  }}
                >
                  以该版本模拟
                </Button>
              ),
            },
          ]}
        />
      )}
    </Card>
  );

  const simulationTab = (
    <Card title="模拟调试" extra={<Tag color="blue">simulation</Tag>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Select
            value={fixtureSetId || undefined}
            onChange={setFixtureSetId}
            options={compatibleFixtures.map((set) => ({ value: set.id, label: set.label }))}
            placeholder="选择 fixture"
            style={{ minWidth: 320 }}
          />
          <Segmented
            value={simSource}
            onChange={(value) => {
              setSimSource(value as 'draft' | 'published');
              setSimulation(null);
            }}
            options={[
              { label: '当前草稿', value: 'draft' },
              { label: '已发布版本', value: 'published' },
            ]}
          />
          {simSource === 'published' ? (
            <Select
              value={simRevision}
              onChange={(value) => {
                setSimRevision(value);
                setSimulation(null);
              }}
              options={record.versions.map((version) => ({ value: version.revision, label: `v${version.revision}` }))}
              placeholder="选择版本"
              style={{ width: 120 }}
            />
          ) : null}
          <Button type="primary" loading={simulating} onClick={() => void runSimulation()}>
            运行模拟
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          模拟只使用固定 fixture 注入节点结果，不调用真实模型、数据库、Worker 或消息投递；保存与投递回执均标记 simulated。模拟使用当前已保存草稿或选定发布版本，未保存的编辑不会参与；fixture 按所选来源和 revision 的实际定义筛选。
        </Typography.Paragraph>

        {simulation ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type={simulation.simulation.runs.some((run) => run.status === 'failed') ? 'warning' : 'success'}
              showIcon
              message={
                simulation.simulation.runs.some((run) => run.status === 'failed')
                  ? '模拟运行包含失败'
                  : '模拟运行完成'
              }
              description={`来源：${simulation.source === 'draft' ? '当前草稿' : `发布版本 v${simulation.revision}`} · digest ${simulation.simulation.digest.slice(0, 16)}… · 结果仅用于调试，不代表真实保存或投递。`}
            />
            {simulation.simulation.duplicateEventIds.length > 0 ? (
              <Alert
                type="info"
                showIcon
                message={`重复事件已忽略：${simulation.simulation.duplicateEventIds.join(', ')}`}
              />
            ) : null}
            {simulation.simulation.runs.map((run) => (
              <Card
                key={run.runId}
                size="small"
                title={
                  <Space wrap>
                    <Tag color="blue">simulation</Tag>
                    <Typography.Text code>{run.runId}</Typography.Text>
                    <Tag>{run.status}</Tag>
                    {run.outcome ? <Tag>{run.outcome}</Tag> : null}
                  </Space>
                }
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  {run.error ? (
                    <Alert
                      type="error"
                      showIcon
                      message={`${run.error.code}: ${run.error.message}`}
                      description={run.error.path}
                    />
                  ) : null}
                  <Descriptions
                    size="small"
                    column={3}
                    items={[
                      { key: 'event', label: '事件 ID', children: <Typography.Text code>{run.eventId}</Typography.Text> },
                      { key: 'model', label: '模型整理次数', children: run.modelComposeCount },
                      { key: 'ops', label: '拟执行操作', children: run.proposedOperations.length },
                    ]}
                  />
                  <Table<WorkflowTraceEntry>
                    size="small"
                    rowKey="seq"
                    pagination={false}
                    scroll={{ x: 960 }}
                    dataSource={[...run.trace]}
                    columns={[
                      { title: '#', dataIndex: 'seq', width: 60 },
                      { title: '时间', dataIndex: 'at', width: 200 },
                      {
                        title: '节点',
                        dataIndex: 'nodeId',
                        width: 150,
                        render: (value: string | null) =>
                          value ? <Typography.Text code>{value}</Typography.Text> : '-',
                      },
                      {
                        title: '节点类型',
                        dataIndex: 'nodeType',
                        width: 140,
                        render: (value: string | null) => (value ? <Tag>{value}</Tag> : '-'),
                      },
                      {
                        title: '轨迹',
                        dataIndex: 'kind',
                        width: 180,
                        render: (value: string) => (
                          <Tag
                            color={
                              value.includes('failed')
                                ? 'red'
                                : value.includes('halted')
                                  ? 'orange'
                                  : value.includes('completed')
                                    ? 'green'
                                    : 'blue'
                            }
                          >
                            {value}
                          </Tag>
                        ),
                      },
                      {
                        title: '详情',
                        dataIndex: 'detail',
                        render: (value: unknown) =>
                          value ? (
                            <Typography.Text code style={{ fontSize: 12 }}>
                              {JSON.stringify(value)}
                            </Typography.Text>
                          ) : (
                            '-'
                          ),
                      },
                    ]}
                  />
                  <Collapse
                    items={[
                      { key: 'outputs', label: '节点输出', children: <pre style={codeBlockStyle}>{formatJson(run.outputs)}</pre> },
                      {
                        key: 'operations',
                        label: '待执行操作（拟调用）',
                        children: <pre style={codeBlockStyle}>{formatJson(run.proposedOperations)}</pre>,
                      },
                      {
                        key: 'fixtures',
                        label: 'Fixture 注入结果',
                        children: <pre style={codeBlockStyle}>{formatJson(run.fixtureLog)}</pre>,
                      },
                    ]}
                  />
                </Space>
              </Card>
            ))}
          </Space>
        ) : null}
      </Space>
    </Card>
  );

  const liveTab = (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="真实运行状态（只读）"
        description={`仅读取已保存的运行记录与业务进度，不触发工作流执行、模型调用或消息投递。运行处理中时每 ${PERIOD_RUN_POLL_INTERVAL_MS / 1000} 秒自动读取一次，最多 ${PERIOD_RUN_POLL_MAX_READS} 次；模拟调试结果与这里分开显示。`}
      />
      <Card title="按 runId 读取真实运行状态">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Input
              value={runIdInput}
              onChange={(event) => setRunIdInput(event.target.value)}
              onPressEnter={submitRunId}
              placeholder="输入 workflow runId"
              allowClear
              style={{ width: 420 }}
            />
            <Button type="primary" loading={runStatus.loading} onClick={submitRunId}>
              读取状态
            </Button>
            {progressProcessing && runStatus.halt === 'idle' && !runStatus.error ? (
              <Tag color="blue">自动轮询中 · 已读取 {runStatus.reads} 次</Tag>
            ) : null}
            {runStatus.halt === 'limit' ? <Tag color="orange">已达自动轮询上限</Tag> : null}
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            runId 会写入地址栏查询参数；打开真实运行页签后继续读取同一个运行。授权仍由平台管理员角色、宿主企业和项目业务权限决定，页面不会自行放行。
          </Typography.Paragraph>
        </Space>
      </Card>

      {runStatus.error?.kind === 'restricted' ? (
        <Alert
          type="error"
          showIcon
          message={`权限失效或运行不可访问，已清除旧状态：${runStatus.error.message}`}
          description={`本次读取失败时间 ${runStatus.error.at}${
            runStatus.error.status ? `（HTTP ${runStatus.error.status}）` : ''
          }。上一次成功读取的绑定、进度与原始轨迹已同时清除，不再展示受限旧投影；自动轮询已停止，确认权限后可点击“读取状态”重新读取。`}
        />
      ) : null}

      {runStatus.error?.kind === 'transient' ? (
        <Alert
          type="error"
          showIcon
          message={`读取运行状态失败，已保留上次快照：${runStatus.error.message}`}
          description={`上次成功读取时间 ${observation?.observedAt ?? '无'}；本次读取失败时间 ${runStatus.error.at}${
            runStatus.error.status ? `（HTTP ${runStatus.error.status}）` : ''
          }。自动轮询已停止，可点击“读取状态”手动重试。`}
        />
      ) : null}

      {runStatus.halt === 'limit' ? (
        <Alert
          type="warning"
          showIcon
          message="自动轮询达到次数上限"
          description={`已连续读取 ${PERIOD_RUN_POLL_MAX_READS} 次，为免页面长期占用已停止自动刷新；可手动点击“读取状态”继续。`}
        />
      ) : null}

      {runStatus.halt === 'terminal' && observation && !runStatus.error ? (
        <Alert
          type="info"
          showIcon
          message="自动轮询已停止"
          description="当前运行已到达终态或无需继续自动读取；可手动重新读取。"
        />
      ) : null}

      {!observation && !runStatus.loading && !runStatus.error ? (
        <Card>
          <Empty description="尚未读取真实运行状态" />
        </Card>
      ) : null}

      {observation ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card
            size="small"
            title={
              <Space wrap>
                <Tag color="green">真实运行</Tag>
                <Typography.Text code>{observation.binding?.runId ?? runStatus.runId}</Typography.Text>
                <Tag color={stateColor(observation.raw.status)}>{stateLabel(observation.raw.status)}</Tag>
                {progress ? <Tag color={stateColor(progress.overall)}>{formatPeriodRunState(progress)}</Tag> : null}
                {binding?.savedReused ? <Tag color="blue">复用已保存报告</Tag> : null}
              </Space>
            }
            extra={<Typography.Text type="secondary">最近读取 {observation.observedAt}</Typography.Text>}
          >
            {!observation.bound || !binding ? (
              <Alert
                type="warning"
                showIcon
                message="未确认保存真实报告任务，无法跟踪"
                description={
                  observation.reasons.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {observation.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    '运行记录中没有已确认的保存回执，因此不展示处理中或成功状态。'
                  )
                }
              />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Descriptions
                  size="small"
                  column={3}
                  items={[
                    { key: 'project', label: '项目', children: `${binding.projectName}（${binding.projectId}）` },
                    {
                      key: 'period',
                      label: binding.periodKind === 'weekly' ? '业务周期' : '业务日期',
                      children: binding.periodKind === 'weekly'
                        ? `${binding.periodStart} ~ ${binding.periodEnd}（上海时间，不含结束日）`
                        : `${binding.periodStart} ~ ${binding.periodEnd}`,
                    },
                    {
                      key: 'definition',
                      label: '定义版本',
                      children: `${binding.definitionId} · v${binding.definitionRevision} · ${binding.digest.slice(0, 16)}…`,
                    },
                    {
                      key: 'report',
                      label: '报告',
                      children: `${binding.reportId} · r${binding.reportRevision} · ${binding.reportKey}`,
                    },
                    { key: 'facts', label: '事实运行', children: <Typography.Text code>{binding.factsRunId}</Typography.Text> },
                    { key: 'binding', label: '保存绑定', children: <Typography.Text code>{binding.bindingId}</Typography.Text> },
                    {
                      key: 'receiver',
                      label: '接收人',
                      children: binding.receiverKind === 'worker'
                        ? `worker ${binding.receiverAdminId ?? ''}`.trim()
                        : '业主',
                    },
                    { key: 'conversation', label: '会话', children: <Typography.Text code>{binding.conversationId}</Typography.Text> },
                    { key: 'savedReused', label: '保存方式', children: binding.savedReused ? '复用已保存任务' : '新建保存任务' },
                  ]}
                />

                {progress ? (
                  <>
                    <Descriptions
                      size="small"
                      column={3}
                      items={[
                        {
                          key: 'overall',
                          label: '总体状态',
                          children: <Tag color={stateColor(progress.overall)}>{formatPeriodRunState(progress)}</Tag>,
                        },
                        {
                          key: 'facts',
                          label: '事实状态',
                          children: <Tag color={stateColor(progress.facts.state)}>{stateLabel(progress.facts.state)}</Tag>,
                        },
                        {
                          key: 'body',
                          label: '正文状态',
                          children: <Tag color={stateColor(progress.body.state)}>{stateLabel(progress.body.state)}</Tag>,
                        },
                        {
                          key: 'delivery',
                          label: '投递状态',
                          children: <Tag color={stateColor(progress.delivery.state)}>{stateLabel(progress.delivery.state)}</Tag>,
                        },
                        {
                          key: 'availability',
                          label: '可用性状态',
                          children: <Tag color={stateColor(progress.availability.state)}>{stateLabel(progress.availability.state)}</Tag>,
                        },
                        { key: 'observedAt', label: '最近一次状态读取', children: observation.observedAt },
                      ]}
                    />
                    {progress.reasons.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="失败 / 未知 / 不可用原因"
                        description={
                          <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {progress.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        }
                      />
                    ) : null}
                    {progress.availability.state !== 'available' && progress.availability.reason ? (
                      <Alert type="warning" showIcon message="可用性原因" description={progress.availability.reason} />
                    ) : null}
                    <Descriptions
                      size="small"
                      column={2}
                      title="排查引用"
                      items={[
                        {
                          key: 'factsRun',
                          label: '事实运行',
                          children: `${progress.facts.runId} · ${stateLabel(progress.facts.runStatus)}${
                            progress.facts.errorCode ? ` · ${progress.facts.errorCode}` : ''
                          }`,
                        },
                        {
                          key: 'factsJob',
                          label: '事实任务',
                          children: progress.facts.job.jobId
                            ? `${progress.facts.job.jobId} · ${stateLabel(progress.facts.job.status)} · 尝试 ${progress.facts.job.attempts} 次`
                            : '未创建任务',
                        },
                        {
                          key: 'bodyRun',
                          label: '正文运行',
                          children: progress.body.runId
                            ? `${progress.body.runId} · ${stateLabel(progress.body.runStatus)}${
                                progress.body.errorCode ? ` · ${progress.body.errorCode}` : ''
                              }`
                            : '未创建',
                        },
                        {
                          key: 'bodyJob',
                          label: '正文任务',
                          children: progress.body.job.jobId
                            ? `${progress.body.job.jobId} · ${stateLabel(progress.body.job.status)} · 尝试 ${progress.body.job.attempts} 次`
                            : '未创建任务',
                        },
                        {
                          key: 'message',
                          label: '消息 ID',
                          children: progress.delivery.messageId ? (
                            <Typography.Text code>{progress.delivery.messageId}</Typography.Text>
                          ) : (
                            '无'
                          ),
                        },
                        {
                          key: 'deliveryConversation',
                          label: '投递会话',
                          children: progress.delivery.conversationId ? (
                            <Typography.Text code>{progress.delivery.conversationId}</Typography.Text>
                          ) : (
                            '无'
                          ),
                        },
                        { key: 'deliveredAt', label: '投递时间', children: progress.delivery.deliveredAt ?? '无' },
                        { key: 'readAt', label: '已读时间', children: progress.delivery.readAt ?? '无' },
                      ]}
                    />
                  </>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="暂无可读取的业务进度"
                    description="已绑定运行记录，但当前没有可用的业务进度视图。"
                  />
                )}
              </Space>
            )}
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <Tag>raw</Tag>
                工作流原始执行轨迹
              </Space>
            }
            extra={raw ? <Typography.Text type="secondary">更新于 {raw.updatedAt}</Typography.Text> : null}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="原始轨迹可能与当前业务进度不同"
                description="这里保留工作流运行记录最后一次写入的原始状态与操作结果，不会因后续业务处理而改写；例如原始投递可能为 delivery_not_confirmed，但业务最终已 delivered。原始失败不会被隐藏或改写。"
              />
              {raw ? (
                <>
                  <Descriptions
                    size="small"
                    column={3}
                    items={[
                      {
                        key: 'status',
                        label: '原始状态',
                        children: <Tag color={stateColor(raw.status)}>{stateLabel(raw.status)}</Tag>,
                      },
                      { key: 'errorCode', label: '原始错误码', children: raw.errorCode ?? '无' },
                      { key: 'errorMessage', label: '原始错误信息', children: raw.errorMessage ?? '无' },
                    ]}
                  />
                  {raw.operations.length > 0 ? (
                    <Table
                      size="small"
                      rowKey={(operation) => `${operation.nodeId}:${operation.capabilityRef}`}
                      pagination={false}
                      scroll={{ x: 900 }}
                      dataSource={[...raw.operations]}
                      columns={[
                        {
                          title: '节点',
                          dataIndex: 'nodeId',
                          width: 180,
                          render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
                        },
                        { title: '能力', dataIndex: 'capabilityRef', width: 240 },
                        {
                          title: '结果',
                          dataIndex: 'outcome',
                          width: 110,
                          render: (value: string) => <Tag color={stateColor(value)}>{stateLabel(value)}</Tag>,
                        },
                        {
                          title: '错误码',
                          dataIndex: 'errorCode',
                          width: 200,
                          render: (value: string | null) => value ?? '-',
                        },
                        {
                          title: '错误信息',
                          dataIndex: 'errorMessage',
                          render: (value: string | null) => value ?? '-',
                        },
                      ]}
                    />
                  ) : (
                    <Empty description="无操作记录" />
                  )}
                </>
              ) : null}
            </Space>
          </Card>
        </Space>
      ) : null}
    </Space>
  );

  return (
    <PageContainer
      header={{
        title: `原生编排 · ${record.definitionId}`,
        subTitle: `${eventLabel} · 草稿 r${record.draft.draftRevision}${latest ? ` · 已发布 v${latest.revision}` : ' · 未发布'}`,
        onBack: () => router.push('/native-workflow'),
      }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="B3 模拟调试入口"
          description="草稿与发布版本存放在 B 线独立调试存储；本轮不接真实模型、现有 Worker、业务写入或消息投递。"
        />
        <Alert
          type="warning"
          showIcon
          message="拖拽画布待已确认设计后接入"
          description="未找到已确认的拖拽画布设计，本轮提供结构化定义 JSON、版本管理和模拟轨迹；不新增自创画布。"
        />
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'draft', label: '草稿与发布', children: draftTab },
            { key: 'versions', label: `已发布版本（${record.versions.length}）`, children: versionsTab },
            { key: 'simulation', label: '模拟调试', children: simulationTab },
            { key: 'live', label: '真实运行', children: liveTab },
          ]}
        />
      </Space>
    </PageContainer>
  );
}
