'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Drawer, Image, Input, Result, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { notify } from '@/components/admin/operation-feedback';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { STYLE_OPTIONS } from '@/lib/portfolio/options';

type TemplateRow = {
  id: string; key: string; title: string; description: string; primary_style: string; layout_types: string[];
  rooms: string; area: number | null; city_name: string; district: string; status: string; version: number;
  updated_at: string; cover_asset_id: string | null; asset_count: number;
};
type TemplateContent = { palette?: Array<{ name: string; hex: string }>; materials?: string[]; highlights?: string[] };
type TemplateDetail = { template: TemplateRow & { content: Partial<TemplateContent> }; images: Array<{ id: string; space: string; position: number }> };

const statusLabels: Record<string, string> = { published: '已上架', retired: '已下架' };
const filters = { status: '', style: '', query: '' };

async function request<T>(path = '', init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/platform/portfolio-templates' + path, { cache: 'no-store', ...init });
  let payload: { success?: boolean; data?: T; error?: string };
  try { payload = await response.json(); } catch { throw new Error('响应中断，请刷新核对。'); }
  if (!response.ok || !payload.success) throw new Error(payload.error || '请求失败，请稍后重试。');
  return payload.data as T;
}
function assetUrl(templateId: string, assetId: string) { return `/api/platform/portfolio-templates/${templateId}/assets/${assetId}`; }
function when(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false }); }

export default function PortfolioTemplatesPage() {
  const { user, isLoading } = useCurrentUser();
  const canManage = ['super_admin', 'admin'].includes(user?.role || '');
  const [items, setItems] = useState<TemplateRow[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [status, setStatus] = useState(filters.status), [style, setStyle] = useState(filters.style), [query, setQuery] = useState(filters.query);
  const [detail, setDetail] = useState<TemplateDetail | null>(null), [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status); if (style) params.set('style', style); if (query) params.set('query', query);
      setItems((await request<{ items: TemplateRow[] }>('?' + params.toString())).items);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取模板失败'); }
    finally { setLoading(false); }
  }, [status, style, query]);
  useEffect(() => { if (canManage) void load(); }, [canManage, load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try { setDetail(await request<TemplateDetail>('/' + id)); }
    catch (reason) { notify.error('读取失败', { description: reason instanceof Error ? reason.message : '请稍后重试。' }); }
    finally { setDetailLoading(false); }
  };
  const changeStatus = async (row: TemplateRow, next: 'published' | 'retired') => {
    setBusy(row.id);
    try {
      await request(`/${row.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, expectedVersion: row.version }),
      });
      notify.success(next === 'published' ? '模板已上架' : '模板已下架', {
        description: next === 'published' ? '所有企业的设计师现在可在素材库中看到该模板。' : '该模板已从企业素材库隐藏，已创建的草稿不受影响。',
      });
      setDetail(current => current && current.template.id === row.id
        ? { ...current, template: { ...current.template, status: next, version: current.template.version + 1 } } : current);
      await load();
    } catch (reason) { notify.error('操作失败', { description: reason instanceof Error ? reason.message : '请刷新后重试。' }); }
    finally { setBusy(''); }
  };

  const columns: ColumnsType<TemplateRow> = [
    { title: '封面', width: 120, render: (_, row) => row.cover_asset_id
      ? <Image width={96} height={72} preview={false} src={assetUrl(row.id, row.cover_asset_id)} alt={row.title} style={{ objectFit: 'cover', borderRadius: 6 }} />
      : <Typography.Text type="secondary">无图</Typography.Text> },
    { title: '模板', width: 320, render: (_, row) => <Space direction="vertical" size={2} style={{ width: '100%', maxWidth: 288 }}>
      <Typography.Text strong ellipsis={{ tooltip: true }} style={{ maxWidth: 288 }}>{row.title}</Typography.Text>
      <Typography.Text type="secondary" ellipsis={{ tooltip: true }} style={{ maxWidth: 288 }}>{row.description || '无说明'}</Typography.Text>
      <Typography.Text type="secondary" ellipsis={{ tooltip: true }} style={{ maxWidth: 288 }}>键：{row.key}</Typography.Text>
    </Space> },
    { title: '风格 / 户型', width: 190, render: (_, row) => <Space size={4} wrap><Tag color="green">{row.primary_style}</Tag>{row.layout_types.map(item => <Tag key={item}>{item}</Tag>)}</Space> },
    { title: '城市 / 面积', width: 170, render: (_, row) => <Space direction="vertical" size={0}>
      <Typography.Text>{row.city_name}{row.district ? '·' + row.district : ''}</Typography.Text>
      <Typography.Text type="secondary">{row.rooms}{row.area ? ` · ${row.area}㎡` : ''}</Typography.Text>
    </Space> },
    { title: '示例图', width: 90, render: (_, row) => `${row.asset_count} 张` },
    { title: '状态', width: 100, render: (_, row) => <Tag color={row.status === 'published' ? 'green' : 'default'}>{statusLabels[row.status] || row.status}</Tag> },
    { title: '更新时间', width: 180, render: (_, row) => <Typography.Text type="secondary">{when(row.updated_at)}</Typography.Text> },
    { title: '操作', width: 170, render: (_, row) => <Space size={4}>
      <Button type="link" size="small" onClick={() => void openDetail(row.id)}>预览</Button>
      {row.status === 'published'
        ? <Button type="link" size="small" danger loading={busy === row.id} onClick={() => void changeStatus(row, 'retired')}>下架</Button>
        : <Button type="link" size="small" loading={busy === row.id} onClick={() => void changeStatus(row, 'published')}>上架</Button>}
    </Space> },
  ];

  if (isLoading) return <PageContainer title="作品集模板"><Card loading /></PageContainer>;
  if (!canManage) return <PageContainer title="作品集模板"><Result status="403" title="无权访问" subTitle="仅平台管理员可维护作品集模板。" /></PageContainer>;

  const content = detail?.template.content;
  return <PageContainer title="作品集模板" subTitle="平台共享模板；上架后所有企业的设计师可在「从素材库创建」中使用。">
    <Alert type="info" showIcon style={{ marginBottom: 16 }}
      message="下架会立即从企业素材库隐藏，已由模板创建的草稿不受影响；模板内容与示例图仍由种子脚本维护。" />
    {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select allowClear placeholder="状态" style={{ width: 130 }} value={status || undefined} onChange={value => setStatus(value || '')}
          options={[{ value: 'published', label: '已上架' }, { value: 'retired', label: '已下架' }]} />
        <Select allowClear placeholder="风格" style={{ width: 130 }} value={style || undefined} onChange={value => setStyle(value || '')}
          options={STYLE_OPTIONS.map(value => ({ value, label: value }))} />
        <Input.Search allowClear placeholder="搜索标题/说明" style={{ width: 240 }} enterButton onSearch={value => setQuery(value)} />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table<TemplateRow> rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={false} tableLayout="fixed"
        locale={{ emptyText: '暂无平台模板，请联系平台管理员导入。' }} scroll={{ x: 1340 }} />
    </Card>
    <Drawer title={detail?.template.title || '模板预览'} width={720} open={!!detail || detailLoading} onClose={() => setDetail(null)} destroyOnHidden
      extra={detail ? <Space>
        <Tag color={detail.template.status === 'published' ? 'green' : 'default'}>{statusLabels[detail.template.status] || detail.template.status}</Tag>
        {detail.template.status === 'published'
          ? <Button danger loading={busy === detail.template.id} onClick={() => void changeStatus(detail.template, 'retired')}>下架</Button>
          : <Button type="primary" loading={busy === detail.template.id} onClick={() => void changeStatus(detail.template, 'published')}>上架</Button>}
      </Space> : null}>
      {detail && <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Image.PreviewGroup><Space wrap size={8}>{detail.images.map(image => <Image key={image.id} width={200} src={assetUrl(detail.template.id, image.id)} alt={image.space} style={{ borderRadius: 8 }} />)}</Space></Image.PreviewGroup>
        <Typography.Paragraph style={{ marginBottom: 0 }}>{detail.template.description || '暂无说明'}</Typography.Paragraph>
        <Space size={4} wrap><Tag color="green">{detail.template.primary_style}</Tag>{detail.template.layout_types.map(item => <Tag key={item}>{item}</Tag>)}<Typography.Text type="secondary">{detail.template.rooms}{detail.template.area ? ` · ${detail.template.area}㎡` : ''}</Typography.Text></Space>
        {!!content?.palette?.length && <Space size={4} wrap>{content.palette.map(item => <Tag key={item.hex} color={item.hex}>{item.name} {item.hex}</Tag>)}</Space>}
        {!!content?.materials?.length && <Typography.Text type="secondary">主材：{content.materials.join('、')}</Typography.Text>}
        {!!content?.highlights?.length && <Typography.Text type="secondary">亮点：{content.highlights.join('；')}</Typography.Text>}
        <Alert type="warning" showIcon message="模板图片为 AI 效果图，aiGenerated 标记随图保留；企业实例化后仍需补充真实信息并走企业审核发布。" />
      </Space>}
    </Drawer>
  </PageContainer>;
}
