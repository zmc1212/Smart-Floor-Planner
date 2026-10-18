'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Drawer, Result, Skeleton, Space, Tabs, Tag } from 'antd';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { hasAssistantKnowledgeAccess } from '@/lib/assistant/access';
import { assistantError, assistantRequest, audienceLabels, formatTime, statusLabels } from '@/components/assistant/client';
import type { Audience, KnowledgeDocument } from '@/components/assistant/contracts';

const KnowledgeEditor = lazy(() => import('@/components/assistant/knowledge-editor').then(module => ({ default: module.KnowledgeEditor })));
const PreviewPanel = lazy(() => import('@/components/assistant/preview-panel').then(module => ({ default: module.PreviewPanel })));
const GuidanceEditor = lazy(() => import('@/components/assistant/guidance-editor').then(module => ({ default: module.GuidanceEditor })));
const HandoffPanel = lazy(() => import('@/components/assistant/handoff-panel').then(module => ({ default: module.HandoffPanel })));
const KnowledgeOperationsPanel = lazy(() => import('@/components/assistant/knowledge-operations').then(module => ({ default: module.KnowledgeOperationsPanel })));

function KnowledgeWorkbench({ canHandoff, canUsage }: { canHandoff: boolean; canUsage:boolean }) {
  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'knowledge';
    const query = new URLSearchParams(window.location.search);
    return query.has('knowledgeBatch') ? 'operations' : query.has('preview') ? 'preview' : 'knowledge';
  });
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ draftId: string; audience: Audience }>();
  const [previewKey, setPreviewKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void assistantRequest<{ items: KnowledgeDocument[] }>(`knowledge/documents?limit=20${cursor ? `&beforeId=${cursor}` : ''}`, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setError(''); setDocuments(previous => cursor ? [...previous, ...result.items] : result.items); setHasMore(result.items.length === 20);
    }).catch(e => { if (!controller.signal.aborted) { setError(assistantError(e)); setDocuments([]); setHasMore(false); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, revision]);
  const refresh = () => { setLoading(true); setCursor(undefined); setRevision(value => value + 1); };
  const columns: ProColumns<KnowledgeDocument>[] = [
    { title: '知识标题', dataIndex: 'title', render: (_, row) => <Button type="link" onClick={() => setEditor(String(row.id))} style={{ whiteSpace: 'normal', textAlign: 'left', height: 'auto' }}>{row.title}</Button> },
    { title: '分类', dataIndex: 'category', renderText: value => value || '未分类' },
    { title: '内容类型', dataIndex: 'source_type', renderText: value => value === 'file' ? '企业文件' : value === 'reference_case' ? '授权参考案例' : value === 'faq' ? '常见问答' : '服务说明' },
    { title: '使用范围', dataIndex: 'audience', renderText: value => audienceLabels[value as Audience] },
    { title: '发布状态', dataIndex: 'status', render: (_, row) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{statusLabels[row.status]}</Tag> },
    { title: '最近更新', dataIndex: 'updated_at', renderText: formatTime },
    { title: '操作', valueType: 'option', render: (_, row) => <Button type="link" onClick={() => setEditor(String(row.id))}>维护版本</Button> },
  ];
  return <>
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'knowledge', label: '企业知识', children: <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Alert type="info" showIcon message="先维护资料，再索引、试问和发布" description="新草稿不会覆盖当前已发布知识。客户只能引用本企业已发布且有效的客户可见资料。" />
        {error && <Alert type="error" showIcon message={error} action={<Button onClick={refresh}>重新加载</Button>} />}
        <ProTable<KnowledgeDocument> rowKey="id" columns={columns} dataSource={documents} loading={loading} search={false} options={false} pagination={false} scroll={{ x: 1000 }} headerTitle="知识资料" toolBarRender={() => [<Button key="refresh" onClick={refresh} disabled={loading}>刷新</Button>, <Button key="create" type="primary" onClick={() => setEditor('new')}>新建知识</Button>]} locale={{ emptyText: error ? '资料暂未读取成功' : '暂无知识，点击“新建知识”录入服务说明或常见问答' }} />
        {hasMore && <Button loading={loading} onClick={() => { setLoading(true); setCursor(String(documents.at(-1)?.id)); }}>加载更多知识</Button>}
      </Space> },
      { key: 'preview', label: '管理员试问', children: <Suspense fallback={<Skeleton active />}><PreviewPanel key={previewKey} seed={seed} /></Suspense> },
      { key: 'operations', label: '问题集与健康', children: <Suspense fallback={<Skeleton active />}><KnowledgeOperationsPanel canUsage={canUsage}/></Suspense> },
      { key: 'guidance', label: '需求引导话术', children: <Suspense fallback={<Skeleton active />}><GuidanceEditor /></Suspense> },
      ...(canHandoff ? [{ key: 'handoffs', label: '真人接续', children: <Suspense fallback={<Skeleton active />}><HandoffPanel /></Suspense> }] : []),
    ]} />
    {editor && <Suspense fallback={<Drawer open width={720} title={editor === 'new' ? '新建知识' : '知识详情'} onClose={() => setEditor(null)}><Space direction="vertical" size={20} style={{ width: '100%' }}><Skeleton active /></Space></Drawer>}>
      <KnowledgeEditor key={editor} documentId={editor} onClose={() => setEditor(null)} onChanged={refresh} onPreview={(draftId, audience) => { setEditor(null); setPreviewKey(value => value + 1); setSeed({ draftId, audience }); setTab('preview'); }} />
    </Suspense>}
  </>;
}
export default function AssistantKnowledgePage() {
  const { user, isLoading, error } = useCurrentUser();
  return <div className="admin-page-frame"><PageContainer title="小 K 知识库" subTitle="维护企业资料，核对回答依据" breadcrumbRender={false} className="admin-page-container">
    {isLoading ? <Skeleton active /> : error ? <Result status="error" title="登录信息读取失败" extra={<Button onClick={() => window.location.reload()}>重新加载</Button>} /> : !hasAssistantKnowledgeAccess(user?.role, user?.effectivePermissions) ? <Result status="403" title="尚未获得小 K 知识管理权限" subTitle="平台管理员、超级管理员及企业明确授权的负责人可维护知识和访问本人试问。" /> : !user?.enterpriseId?._id ? <Result status="info" title="请先选择企业" subTitle="通过侧栏顶部的企业选择器选择一家企业，再查看和维护该企业的小 K 知识。" /> : <KnowledgeWorkbench canHandoff={user?.role === 'enterprise_admin'} canUsage={user?.role==='enterprise_admin'&&Boolean(user?.effectivePermissions?.includes('assistant-usage'))} key={`${user?._id}:${user?.enterpriseId?._id}`} />}
  </PageContainer></div>;
}
