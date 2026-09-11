'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Alert, Button, Card, Checkbox, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { parseDraft, REPORT_PURPOSES, type ReportAsset, type ReportDraft, type ReportPage } from '@/lib/design-reports/contract';
import { renderReport } from '@/lib/design-reports/render';

type ReportDto = { id: string; leadId: string; customer: string; draft: ReportDraft; version: number; publishedVersion: number | null; shareUrl: string | null; updatedAt: string; canRestore: boolean; assets?: ReportAsset[] };
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '操作失败');
  return result.data;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }

export function ReportList({ leadId }: { leadId?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<ReportDto[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; communityName: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const searchSequence = useRef(0);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api<ReportDto[]>(`/api/design-reports${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ''}`)); setError(''); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [leadId]);
  useEffect(() => { void load(); }, [load]);
  const searchCustomers = async (query: string) => {
    const sequence = ++searchSequence.current;
    try { const result = await api<typeof customers>(`/api/design-reports?view=customers&q=${encodeURIComponent(query)}`); if (sequence === searchSequence.current) setCustomers(result); }
    catch (e) { notify.error(errorMessage(e)); }
  };
  return <PageContainer title="设计汇报" subTitle="把客户资料与设计成果整理为可讲解、可交付的方案" extra={<Button type="primary" onClick={() => { form.setFieldsValue({ leadId, purpose: 'proposal', title: '家装设计方案汇报' }); setOpen(true); void searchCustomers(''); }}>新建设计汇报</Button>}>
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <ProTable<ReportDto> rowKey="id" loading={loading} dataSource={rows} search={false} options={false} pagination={{ pageSize: 10 }} columns={[
      { title: '汇报名称', render: (_, row) => <Button type="link" onClick={() => router.push(`/design-reports/${row.id}`)}>{row.draft.title}</Button> },
      { title: '客户', dataIndex: 'customer' },
      { title: '汇报目的', render: (_, row) => REPORT_PURPOSES[row.draft.purpose] },
      { title: '状态', render: (_, row) => <Tag color={row.shareUrl ? 'green' : 'default'}>{row.shareUrl ? '已发布' : '草稿'}</Tag> },
      { title: '更新时间', render: (_, row) => new Date(row.updatedAt).toLocaleString('zh-CN') },
      { title: '操作', render: (_, row) => <Space><Button onClick={() => router.push(`/design-reports/${row.id}`)}>编辑汇报</Button>{row.shareUrl && <Button href={row.shareUrl} target="_blank">查看发布版</Button>}</Space> },
    ]} />
    <Modal title="新建设计汇报" open={open} confirmLoading={creating} onCancel={() => setOpen(false)} okText="创建汇报" onOk={async () => {
      try { const values = await form.validateFields(); setCreating(true); const row = await api<ReportDto>('/api/design-reports', 'POST', values); notify.success('汇报草稿已创建'); router.push(`/design-reports/${row.id}`); }
      catch (e) { if (e instanceof Error) notify.error(e.message); } finally { setCreating(false); }
    }}>
      <Form form={form} layout="vertical">
        <Form.Item name="leadId" label="客户" rules={[{ required: true, message: '请选择客户' }]}><Select showSearch filterOption={false} onSearch={(q) => void searchCustomers(q)} options={customers.map((c) => ({ value: c.id, label: `${c.name}${c.communityName ? ` · ${c.communityName}` : ''}` }))} placeholder="搜索客户姓名" /></Form.Item>
        <Form.Item name="title" label="汇报标题" rules={[{ required: true, whitespace: true, message: '请填写标题' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="purpose" label="汇报目的" rules={[{ required: true }]}><Select options={Object.entries(REPORT_PURPOSES).map(([value, label]) => ({ value, label }))} /></Form.Item>
      </Form>
    </Modal>
  </PageContainer>;
}

export function ReportEditor({ id }: { id: string }) {
  const [record, setRecord] = useState<ReportDto | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const [aiOpen, setAiOpen] = useState<'outline' | 'page' | null>(null);
  const [instruction, setInstruction] = useState('');
  const [suggestion, setSuggestion] = useState<string | string[] | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [undo, setUndo] = useState<ReportDraft | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const dirty = Boolean(record && draft && JSON.stringify(record.draft) !== JSON.stringify(draft));
  const current = draft?.pages.find((p) => p.id === selected) || draft?.pages[0];
  const load = useCallback(async () => {
    try { const value = await api<ReportDto>(`/api/design-reports/${id}`); setRecord(value); setDraft(value.draft); setSelected(value.draft.pages[0].id); setError(''); setUndo(null); }
    catch (e) { setError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const save = async () => {
    if (!draft || !record) return;
    setBusy('save');
    try { const normalized = parseDraft(draft); const row = await api<ReportDto>(`/api/design-reports/${id}`, 'PUT', { version: record.version, draft: normalized }); setRecord({ ...record, ...row }); setDraft(row.draft); notify.success('汇报已保存'); return row; }
    catch (e) { notify.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const mutate = async (action: string, message: string) => {
    if (!record) return;
    setBusy(action);
    try { const row = await api<ReportDto>(`/api/design-reports/${id}/${action}`, 'POST', { version: record.version }); setRecord({ ...record, ...row }); setDraft(row.draft); notify.success(message); setPublishOpen(false); }
    catch (e) { notify.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const editPage = (patch: Partial<ReportPage>) => { if (draft && current) setDraft({ ...draft, outlineConfirmed: patch.title !== undefined ? false : draft.outlineConfirmed, pages: draft.pages.map((p) => p.id === current.id ? { ...p, ...patch } : p) }); };
  const openAi = async (kind: 'outline' | 'page') => {
    setInstruction(''); setSuggestion(null); setAiOpen(kind); setPrice(null);
    try { setPrice((await api<{ credits: number }>(`/api/design-reports/${id}/price`)).credits); } catch (e) { notify.error(errorMessage(e)); }
  };
  if (!record || !draft) return <PageContainer title="设计汇报">{error ? <Alert type="error" message={error} action={<Button onClick={() => void load()}>重新加载</Button>} /> : <Spin />}</PageContainer>;
  const assets = record.assets || [];
  const urls = Object.fromEntries(assets.map((a) => [a.id, a.url]));
  const previewHtml = renderReport(draft, urls);
  const move = (delta: number) => {
    if (!current) return; const index = draft.pages.findIndex((p) => p.id === current.id); const next = index + delta;
    if (next < 0 || next >= draft.pages.length) return;
    const pages = [...draft.pages]; [pages[index], pages[next]] = [pages[next], pages[index]]; setDraft({ ...draft, pages, outlineConfirmed: false });
  };
  return <PageContainer title={draft.title} subTitle={`${record.customer} · ${dirty ? '有未保存修改' : '已保存'} · ${record.shareUrl ? '已有发布版本' : '尚未发布'}`} extra={<Space wrap>
    <Button href="/design-reports" onClick={(event) => { if (dirty && !window.confirm('存在未保存修改，确定离开？')) event.preventDefault(); }}>汇报列表</Button>
    <Button onClick={() => setPreview(true)}>预览 / 演示</Button>
    <Button loading={busy === 'save'} disabled={Boolean(busy)} onClick={() => void save()}>保存草稿</Button>
    <Button type="primary" disabled={Boolean(busy) || dirty || !draft.outlineConfirmed} onClick={() => setPublishOpen(true)}>{record.shareUrl ? '更新发布' : '发布汇报'}</Button>
  </Space>}>
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="选择素材 → 确认大纲 → 编辑各页 → 预览并发布" description="方案图来自已发布给客户的设计；现场照片和户型图需主动勾选。AI 仅辅助文案与大纲，采用前请核对事实。" />
      {record.shareUrl && <Card size="small"><Space wrap><Tag color="green">发布版本 {record.publishedVersion}</Tag><Button href={record.shareUrl} target="_blank">打开客户阅读版</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(new URL(record.shareUrl!, window.location.origin).href); notify.success('分享链接已复制'); } catch { notify.error('复制失败，请打开阅读版后复制地址'); } }}>复制分享链接</Button><Popconfirm title="撤回后，此链接将无法继续查看" onConfirm={() => mutate('withdraw', '汇报已撤回')}><Button danger disabled={Boolean(busy)}>撤回分享</Button></Popconfirm><Typography.Text type="secondary">持有链接的人可阅读；重新发布会使旧链接失效。</Typography.Text></Space></Card>}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6}><Card title="汇报大纲" size="small">
          <Form layout="vertical"><Form.Item label="标题"><Input value={draft.title} maxLength={100} disabled={Boolean(busy)} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Form.Item><Form.Item label="汇报目的"><Select value={draft.purpose} disabled={Boolean(busy)} style={{ width: '100%' }} options={Object.entries(REPORT_PURPOSES).map(([value, label]) => ({ value, label }))} onChange={(purpose) => setDraft({ ...draft, purpose, outlineConfirmed: false })} /></Form.Item></Form>
          <Space direction="vertical" style={{ width: '100%' }}>
            {draft.pages.map((p, i) => <Button block key={p.id} type={current?.id === p.id ? 'primary' : 'default'} onClick={() => setSelected(p.id)} style={{ textAlign: 'left', height: 'auto', whiteSpace: 'normal' }}>{i + 1}. {p.title || '未命名章节'}</Button>)}
            <Space wrap><Button aria-label="章节上移" icon={<ArrowUp size={16} />} disabled={Boolean(busy) || current?.id === draft.pages[0].id} onClick={() => move(-1)} /><Button aria-label="章节下移" icon={<ArrowDown size={16} />} disabled={Boolean(busy) || current?.id === draft.pages.at(-1)?.id} onClick={() => move(1)} /><Button icon={<Plus size={16} />} disabled={Boolean(busy) || draft.pages.length >= 30} onClick={() => { const page = { id: crypto.randomUUID(), title: '新章节', body: '', assetIds: [] }; setDraft({ ...draft, outlineConfirmed: false, pages: [...draft.pages, page] }); setSelected(page.id); }}>添加</Button></Space>
            <Button disabled={Boolean(busy) || dirty} onClick={() => void openAi('outline')}>AI 建议大纲</Button>
            <Checkbox checked={draft.outlineConfirmed} disabled={Boolean(busy)} onChange={(e) => setDraft({ ...draft, outlineConfirmed: e.target.checked })}>已确认大纲</Checkbox>
          </Space>
        </Card></Col>
        <Col xs={24} lg={10}><Card title="当前页预览" size="small" extra={<Select aria-label="浏览模式" value={draft.mode} disabled={Boolean(busy)} options={[{ value: 'scroll', label: '连续阅读' }, { value: 'slides', label: '逐页演示' }]} onChange={(mode) => setDraft({ ...draft, mode })} />}>
          <Typography.Text type="secondary">{draft.title}</Typography.Text><Typography.Title level={2}>{current?.title}</Typography.Title>
          <Row gutter={[12, 12]}>{current?.assetIds.map((assetId) => <Col span={current.assetIds.length === 1 ? 24 : 12} key={assetId}>{urls[assetId] ? <img src={urls[assetId]} alt={assets.find((a) => a.id === assetId)?.title || '汇报素材'} style={{ width: '100%', height: 220, objectFit: 'contain' }} /> : <Alert type="warning" message="素材已失效，请移除后重新选择" />}</Col>)}</Row>
          {!current?.assetIds.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从右侧选择本页图片，也可以保留为文字页" />}
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{current?.body || '在右侧补充本页说明'}</Typography.Paragraph>
        </Card></Col>
        <Col xs={24} lg={8}><Card title="编辑当前页" size="small" extra={<Popconfirm title="删除当前章节？" onConfirm={() => { setDraft({ ...draft, outlineConfirmed: false, pages: draft.pages.filter((p) => p.id !== current?.id) }); setSelected(''); }}><Button aria-label="删除章节" danger icon={<Trash2 size={16} />} disabled={Boolean(busy) || draft.pages.length <= 1} /></Popconfirm>}>
          <Form layout="vertical"><Form.Item label="章节标题"><Input value={current?.title} maxLength={100} disabled={Boolean(busy)} onChange={(e) => editPage({ title: e.target.value })} /></Form.Item>
            <Form.Item label="正文说明"><Input.TextArea value={current?.body} maxLength={3000} showCount autoSize={{ minRows: 7, maxRows: 16 }} disabled={Boolean(busy)} onChange={(e) => editPage({ body: e.target.value })} /></Form.Item>
            <Form.Item label="本页图片（最多 4 张，按选择顺序展示）"><Select mode="multiple" value={current?.assetIds} disabled={Boolean(busy)} style={{ width: '100%' }} onChange={(assetIds) => { if (assetIds.length <= 4) editPage({ assetIds }); else notify.error('每页最多选择 4 张图片'); }} options={assets.map((a) => ({ value: a.id, label: `${({ design: '方案', site: '现场', plan: '户型' })[a.kind]} · ${a.title}` }))} /></Form.Item>
          </Form>
          <Button disabled={Boolean(busy) || dirty || !draft.outlineConfirmed} onClick={() => void openAi('page')}>AI 修改本页文案</Button>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>使用 AI 前请先保存；修改要求只影响当前章节。首版不自动识图，图片细节请在正文或修改要求中说明。</Typography.Paragraph>
        </Card></Col>
      </Row>
      <Space wrap><Popconfirm title="恢复上次保存内容？当前草稿将被替换，发布版本不变。" onConfirm={() => mutate('restore', '已恢复上次保存内容')}><Button disabled={Boolean(busy) || dirty || !record.canRestore}>恢复上次保存</Button></Popconfirm>
        <Button disabled={Boolean(busy) || !undo} onClick={() => { if (undo) { setDraft(undo); setUndo(null); notify.success('已撤销本次 AI 修改'); } }}>撤销本次 AI 修改</Button>
        <Button disabled={Boolean(busy) || dirty} loading={busy === 'export'} onClick={async () => {
          setBusy('export'); try { const res = await fetch(`/api/design-reports/${id}/export`); if (!res.ok) throw new Error((await res.json()).error); const url = URL.createObjectURL(await res.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `design-report-${id}.html`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); notify.success('离线 HTML 已导出'); } catch (e) { notify.error(errorMessage(e)); } finally { setBusy(''); }
        }}>导出离线 HTML</Button><Typography.Text type="secondary">离线文件不随在线撤回失效。长内容在演示页内可滚动。</Typography.Text>
      </Space>
    </Space>
    <Modal title="预览与演示" width="95vw" open={preview} onCancel={() => setPreview(false)} footer={null} destroyOnHidden><iframe title="设计汇报预览" srcDoc={previewHtml} sandbox="allow-scripts allow-same-origin allow-popups" allowFullScreen style={{ width: '100%', height: '75vh', border: 0 }} /></Modal>
    <Modal title="确认发布内容" open={publishOpen} confirmLoading={busy === 'publish'} onCancel={() => setPublishOpen(false)} okText="确认发布" onOk={() => void mutate('publish', '汇报已发布')}><Typography.Paragraph>将发布当前已保存的 {draft.pages.length} 个章节及所选图片。请确认客户信息、现场照片、户型和文案均适合对外展示。持有链接的人无需登录即可阅读。</Typography.Paragraph><Typography.Paragraph>更新发布会替换发布快照并生成新链接，旧链接立即失效。</Typography.Paragraph></Modal>
    <Modal title={aiOpen === 'outline' ? 'AI 建议大纲' : 'AI 修改本页文案'} open={Boolean(aiOpen)} onCancel={() => { if (!busy) setAiOpen(null); }} footer={<Space><Button disabled={Boolean(busy)} onClick={() => setAiOpen(null)}>取消</Button><Button loading={busy === 'generate'} disabled={Boolean(busy) || price === null} onClick={async () => {
      setBusy('generate'); setSuggestion(null);
      try { const data = await api<{ suggestion: string | string[] }>(`/api/design-reports/${id}/generate`, 'POST', { version: record.version, kind: aiOpen, pageId: current?.id, instruction }); setSuggestion(data.suggestion); notify.success('AI 建议已生成，请核对后采用'); }
      catch (e) { notify.error(errorMessage(e)); } finally { setBusy(''); }
    }}>生成建议{price !== null ? `（${price} 点）` : ''}</Button><Button type="primary" disabled={Boolean(busy) || !suggestion} onClick={() => {
      if (!suggestion) return; setUndo(draft);
      if (aiOpen === 'outline' && Array.isArray(suggestion)) {
        // Preserve existing content and image selection for matching chapter titles.
        const pages = suggestion.map((title, i) => { const match = draft.pages.find((p) => p.title === title); return match ? { ...match, id: `ai-${Date.now()}-${i}` } : { id: `ai-${Date.now()}-${i}`, title: title.slice(0, 100), body: '', assetIds: [] }; });
        setDraft({ ...draft, outlineConfirmed: false, pages }); setSelected(pages[0]?.id || '');
      } else if (typeof suggestion === 'string') editPage({ body: suggestion.slice(0, 3000) });
      setAiOpen(null); notify.success('已采用到草稿，请检查并保存');
    }}>采用建议</Button></Space>}>
      <Alert type="info" message="生成使用平台文本模型与设计建议计费规则；采用前请核对事实。" />
      <Input.TextArea aria-label="修改要求" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1500} disabled={Boolean(busy)} rows={4} placeholder={aiOpen === 'outline' ? '例如：重点介绍客厅和收纳，控制在五个章节' : '例如：说明简短一些，补充客户明确要求的收纳需求'} style={{ marginTop: 16 }} />
      {suggestion && <Card title="待采用建议" style={{ marginTop: 16 }}><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{Array.isArray(suggestion) ? suggestion.join('\n') : suggestion}</Typography.Paragraph>{aiOpen === 'outline' && <Typography.Text type="warning">采用会替换大纲，仅同名章节保留原内容。可使用“撤销本次 AI 修改”恢复。</Typography.Text>}</Card>}
    </Modal>
  </PageContainer>;
}
