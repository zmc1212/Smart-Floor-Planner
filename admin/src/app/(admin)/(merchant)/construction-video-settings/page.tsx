'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Col, Descriptions, Empty, Flex, Form, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { RefreshCw, Save, Settings, Video } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { constructionRequest, errorText, type Project } from '@/components/construction/client';
import { notify } from '@/components/admin/operation-feedback';

type CameraRow = {
  id: string;
  binding_id?: string;
  name: string;
  recording_enabled?: boolean;
  retention_days?: number;
  retention_override_days?: number | null;
  recording_mode?: 'cloud' | 'sd';
  recording_state?: string;
};

type VideoSettings = {
  items: CameraRow[];
  canConfigure: boolean;
  maxRetentionDays: number;
  coverDefault: { intervalHours: number; version: number } | null;
  retentionDefault: { retentionDays: number; version: number; affectedCount: number } | null;
};

type CoverForm = { intervalHours: number; expectedVersion: number };
type RetentionForm = { retentionDays: number; expectedVersion: number };

const recordingState: Record<string, string> = {
  recording: '正在录制',
  pending: '正在应用设置',
  stopped: '已停止',
  error: '录制异常',
};

export default function ConstructionVideoSettingsPage() {
  const { user, isLoading } = useCurrentUser();
  const identity = user?._id ? `${user._id}:${user.enterpriseId?._id || 'unselected'}` : '';
  return (
    <PageContainer
      breadcrumbRender={false}
      title="工地视频设置"
      content="按工地配置监控封面的抓拍间隔和录像留存；抓拍图片沿用同一留存策略自动清理。"
    >
      {!isLoading && identity && <VideoSettingsWorkbench key={identity} />}
    </PageContainer>
  );
}

function VideoSettingsWorkbench() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [settings, setSettings] = useState<VideoSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [coverForm] = Form.useForm<CoverForm>();
  const [retentionForm] = Form.useForm<RetentionForm>();
  const alive = useRef(true);
  const requestSequence = useRef(0);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true); setError('');
    try {
      const list = await constructionRequest<{ items: Project[] }>('projects');
      if (!alive.current) return;
      setProjects(list.items);
      setProjectId(current => current && list.items.some(item => item.id === current) ? current : (list.items[0]?.id || ''));
    } catch (e) {
      if (alive.current) { setError(errorText(e)); setProjects([]); setSettings(null); }
    } finally {
      if (alive.current) setProjectsLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async (pid: string) => {
    if (!pid) { setSettings(null); setLoading(false); return; }
    const sequence = ++requestSequence.current;
    setSettings(null); setLoading(true); setError('');
    try {
      const data = await constructionRequest<VideoSettings>(`video/projects/${pid}/cameras`);
      if (!alive.current || sequence !== requestSequence.current) return;
      setSettings(data);
      coverForm.resetFields(); retentionForm.resetFields();
      if (data.coverDefault) coverForm.setFieldsValue({ intervalHours: data.coverDefault.intervalHours, expectedVersion: data.coverDefault.version });
      if (data.retentionDefault) retentionForm.setFieldsValue({ retentionDays: data.retentionDefault.retentionDays, expectedVersion: data.retentionDefault.version });
    } catch (e) {
      if (!alive.current || sequence !== requestSequence.current) return;
      setSettings(null); setError(errorText(e));
    } finally {
      if (alive.current && sequence === requestSequence.current) setLoading(false);
    }
  }, [coverForm, retentionForm]);

  useEffect(() => {
    alive.current = true;
    const sequence = requestSequence;
    void loadProjects();
    return () => { alive.current = false; sequence.current++; };
  }, [loadProjects]);

  useEffect(() => {
    if (projectId) void loadSettings(projectId);
  }, [projectId, loadSettings]);

  const save = async (kind: 'cover' | 'retention') => {
    if (!projectId) return;
    const pid = projectId;
    setSaving(kind);
    try {
      if (kind === 'cover') {
        const values = await coverForm.validateFields();
        await constructionRequest(`video/projects/${pid}/cover-interval`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
        });
        notify.success('封面抓拍间隔已保存');
      } else {
        const values = await retentionForm.validateFields();
        await constructionRequest(`video/projects/${pid}/retention-default`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
        });
        notify.success('企业默认录像留存已保存');
      }
      await loadSettings(pid);
    } catch (e) {
      notify.error(kind === 'cover' ? '封面抓拍设置未保存' : '录像留存设置未保存', { description: errorText(e) });
    } finally {
      if (alive.current) setSaving('');
    }
  };

  const selected = projects.find(item => item.id === projectId);
  const configurable = settings?.canConfigure === true;
  const effectiveDays = settings?.retentionDefault?.retentionDays ?? settings?.items[0]?.retention_days ?? null;

  return (
    <Flex vertical gap={20}>
      <Card>
        <Flex wrap gap={16} align="flex-end" justify="space-between">
          <Space direction="vertical" size={4} style={{ flex: '1 1 320px' }}>
            <Typography.Text strong>选择工地</Typography.Text>
            <Select
              showSearch
              value={projectId || undefined}
              placeholder={projects.length ? '请选择需要配置的工地' : '当前企业暂无在建工地'}
              style={{ width: '100%', maxWidth: 420 }}
              optionFilterProp="label"
              options={projects.map(item => ({ value: item.id, label: item.name }))}
              onChange={setProjectId}
              disabled={projectsLoading || !projects.length}
              aria-label="选择工地"
            />
          </Space>
          <Button icon={<RefreshCw size={16} />} loading={projectsLoading} onClick={() => void loadProjects()}>刷新</Button>
        </Flex>
        {selected && <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>当前工地：{selected.name}</Typography.Text>}
      </Card>

      {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void loadProjects()}>重新读取</Button>} />}
      {!projectsLoading && !error && !projects.length && <Card><Empty description="当前企业还没有可配置的在建工地" /></Card>}
      {!error && settings && !configurable && (
        <Alert type="warning" showIcon message="当前身份只能查看，不能修改视频设置" description="封面抓拍间隔和企业默认留存仅企业负责人、管理员可修改；项目经理和成员可继续查看当前配置。" />
      )}

      {settings && (
        <>
          {configurable && (
            <Row gutter={[20, 20]}>
            <Col xs={24} xl={12}>
              <Card loading={loading} title={<Space><Video size={18} />封面抓拍</Space>}>
                <Form<CoverForm>
                  form={coverForm}
                  layout="vertical"
                  disabled={!configurable || !!saving}
                  onFinish={() => void save('cover')}
                >
                  <Form.Item name="expectedVersion" hidden><InputNumber /></Form.Item>
                  <Form.Item
                    name="intervalHours"
                    label="抓拍间隔（小时）"
                    rules={[{ required: true, type: 'number', min: 1, max: 24, message: '请填写 1–24 之间的整数小时' }]}
                    extra="默认每小时一次，可按 1–24 小时调整。保存后从下一个间隔时段起生效。"
                  >
                    <InputNumber min={1} max={24} precision={0} style={{ width: 180 }} addonAfter="小时" />
                  </Form.Item>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    后台只对业主首页展示的那路机位定时抓拍，其他机位不会被唤醒。设备离线或当次抓拍失败时保留上一张封面并显示拍摄时间，不影响打开工地。
                  </Typography.Paragraph>
                  <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving === 'cover'} disabled={!configurable || !!saving}>保存抓拍间隔</Button>
                </Form>
              </Card>
            </Col>

            <Col xs={24} xl={12}>
              <Card loading={loading} title={<Space><Settings size={18} />录像留存</Space>}>
                <Form<RetentionForm>
                  form={retentionForm}
                  layout="vertical"
                  disabled={!configurable || !!saving}
                  onFinish={() => void save('retention')}
                >
                  <Form.Item name="expectedVersion" hidden><InputNumber /></Form.Item>
                  <Form.Item
                    name="retentionDays"
                    label="企业默认留存（天）"
                    rules={[{ required: true, type: 'number', min: 1, max: settings.maxRetentionDays, message: `请填写 1–${settings.maxRetentionDays} 之间的整数天数` }]}
                    extra={`当前节点最多 ${settings.maxRetentionDays} 天。该天数同时决定抓拍图片的保留时间。`}
                  >
                    <InputNumber min={1} max={settings.maxRetentionDays} precision={0} style={{ width: 180 }} addonAfter="天" />
                  </Form.Item>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    保存后应用于仍在绑定且选择继承企业默认的云端录像策略，不会开启已关闭的录像。单独设置、SD 模式和历史绑定保留原天数；缩短后过期内容不可播放并进入清理。
                  </Typography.Paragraph>
                  <Button type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving === 'retention'} disabled={!configurable || !!saving}>保存录像留存</Button>
                </Form>
              </Card>
            </Col>
          </Row>
          )}

          <Card
            loading={loading}
            title="抓拍留存与清理"
            extra={<Typography.Text type="secondary">自动执行，无需手动清理</Typography.Text>}
          >
            <Descriptions column={{ xs: 1, sm: 2, xl: 4 }} size="small" bordered>
              <Descriptions.Item label="生效留存">
                {effectiveDays ?? '—'} 天
              </Descriptions.Item>
              <Descriptions.Item label="继承企业默认的录像策略">
                {settings.retentionDefault?.affectedCount ?? '—'} 路
              </Descriptions.Item>
              <Descriptions.Item label="节点上限">
                {settings.maxRetentionDays} 天
              </Descriptions.Item>
              <Descriptions.Item label="封面抓拍范围">
                仅首页展示机位
              </Descriptions.Item>
            </Descriptions>
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              message="过期抓拍会自动清理"
              description="后台每分钟最多清理 100 张超过留存期的抓拍：清除图片字节，保留文件和审计记录，不会提前删除有效期内画面。定时封面同样沿用该留存策略，不进入手动抓拍历史。"
            />
            <Table<CameraRow>
              style={{ marginTop: 16 }}
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={settings.items}
              locale={{ emptyText: <Empty description="当前工地尚未绑定摄像头" /> }}
              columns={[
                { title: '摄像头', dataIndex: 'name' },
                {
                  title: '录像模式',
                  width: 140,
                  render: (_, row) => <Tag color={row.recording_mode === 'sd' ? 'gold' : 'blue'}>{row.recording_mode === 'sd' ? '4G · 本地 SD' : '云端录像'}</Tag>,
                },
                {
                  title: '生效留存',
                  width: 120,
                  render: (_, row) => `${row.retention_days ?? settings.retentionDefault?.retentionDays ?? '—'} 天`,
                },
                {
                  title: '留存来源',
                  width: 150,
                  render: (_, row) => row.retention_override_days == null
                    ? <Tag>继承企业默认</Tag>
                    : <Tag color="processing">单独设置 {row.retention_override_days} 天</Tag>,
                },
                {
                  title: '录像状态',
                  width: 130,
                  render: (_, row) => recordingState[row.recording_state || ''] || (row.recording_enabled ? '已开启' : '未开启'),
                },
              ]}
            />
          </Card>
        </>
      )}
    </Flex>
  );
}
