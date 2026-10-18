'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Drawer, Empty, Input, List, Modal, Popconfirm, Row, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, AssistantRequestError, assistantError, assistantRequest, audienceLabels, formatTime, runIsActive, statusLabels } from './client';
import type { AssistantRun, Audience, Citation, PageResult, PreviewConversation, PreviewMessage } from './contracts';
import { RetrievalDiagnostics } from './retrieval-diagnostics';

export function PreviewPanel({ seed }: { seed?: { draftId: string; audience: Audience } }) {
  const [list, setList] = useState<PreviewConversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === 'undefined' || seed) return null;
    const id = new URLSearchParams(window.location.search).get('preview');
    return id && /^[1-9]\d*$/.test(id) ? id : null;
  });
  const [conversation, setConversation] = useState<PreviewConversation | null>(null);
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [run, setRun] = useState<AssistantRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<{ key: string; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(Boolean(seed));
  const [audience, setAudience] = useState<Audience | 'all'>(seed?.audience || 'customer_public');
  const [citationId, setCitationId] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [citationError, setCitationError] = useState('');
  const mutations = useRef(new AssistantMutations());
  const lock = useRef(false);

  const readList = useCallback(async (next?: string, signal?: AbortSignal) => {
    setListLoading(true); setListError('');
    try {
      const result = await assistantRequest<PageResult<PreviewConversation>>(`preview/conversations?limit=20${next ? `&cursor=${next}` : ''}`, { signal });
      if (signal?.aborted) return;
      setList(previous => next ? [...previous, ...result.items] : result.items); setCursor(result.nextCursor);
    } catch (e) { if (!signal?.aborted) setListError(assistantError(e)); }
    finally { if (!signal?.aborted) setListLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void readList(undefined, controller.signal); return () => controller.abort(); }, [readList]);

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setError(''); setConversation(null); setMessages([]); setRun(null); setCitationId(null);
    const read = async () => {
      try {
        // Re-authorize and re-project history when opening, refreshing, or
        // polling an active run. Never merge cached quotes into a new read.
        const [current, history] = await Promise.all([
          assistantRequest<PreviewConversation>(`preview/conversations/${conversationId}`, { signal: controller.signal }),
          assistantRequest<PageResult<PreviewMessage>>(`preview/conversations/${conversationId}/messages?limit=50`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setConversation(current); setMessages([...history.items].reverse()); setMessageCursor(history.nextCursor); setRun(current.latestRun || null); setError('');
        if (runIsActive(current.latestRun)) timer = setTimeout(read, 1800);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(assistantError(e));
          // Fail closed: do not retain a stale transcript following a denied read.
          setMessages([]); setConversation(null); setRun(null); setCitationId(null);
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [conversationId, reload]);

  useEffect(() => {
    if (!citationId) return;
    const controller = new AbortController(); setCitation(null); setCitationError('');
    void assistantRequest<Citation>(`preview/citations/${citationId}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCitation(value); })
      .catch(e => { if (!controller.signal.aborted) setCitationError(assistantError(e)); });
    return () => controller.abort();
  }, [citationId]);

  const select = (id: string) => {
    if (pending || busy) return;
    if (question && !window.confirm('切换会话将放弃尚未发送的文字，是否继续？')) return;
    setQuestion(''); setConversationId(id);
    const url = new URL(window.location.href); url.searchParams.set('preview', id); window.history.replaceState(null, '', url);
  };
  const operate = async (work: () => Promise<void>, success: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); notify.success(success); setReload(value => value + 1); void readList(); }
    catch (e) { setError(assistantError(e)); notify.error(assistantError(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const send = () => operate(async () => {
    if (!conversationId || (!pending && !question.trim())) return;
    const submission = pending || { key: crypto.randomUUID(), text: question };
    setPending(submission);
    try {
      await mutations.current.write(`preview/conversations/${conversationId}/messages`, { clientMessageId: submission.key, content: { version: 1, blocks: [{ type: 'text', text: submission.text }] } }, 'POST', submission.key);
      setPending(null); setQuestion('');
    } catch (e) {
      if (e instanceof AssistantRequestError && !e.uncertain) setPending(null);
      throw e;
    }
  }, '问题已提交');
  const older = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const history = await assistantRequest<PageResult<PreviewMessage>>(`preview/conversations/${conversationId}/messages?limit=50&beforeSeq=${messageCursor}`);
      setMessages(previous => [...history.items].reverse().concat(previous)); setMessageCursor(history.nextCursor);
    } catch (e) { setError(assistantError(e)); notify.error(assistantError(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const active = runIsActive(run);
  return <>
    <Alert type="info" showIcon message="管理员试问仅本人可见" description="默认模拟客户可见知识；草稿试问不发布资料，也不会创建客户记录。试问使用本企业额度。" style={{ marginBottom: 20 }} />
    <Row gutter={[20, 20]}>
      <Col xs={24} lg={7}>
        <Card className="admin-panel-card" title="我的试问" extra={<Button type="primary" disabled={busy || Boolean(pending)} onClick={() => setCreateOpen(true)}>新建试问</Button>}>
          {listError && <Alert type="error" message={listError} action={<Button onClick={() => { void readList(); }}>重试</Button>} />}
          <List loading={listLoading} dataSource={list} locale={{ emptyText: <Empty description="还没有试问会话" /> }} renderItem={item => <List.Item>
            <Button block type={conversationId === item.id ? 'primary' : 'text'} disabled={busy || Boolean(pending)} onClick={() => select(item.id)} style={{ height: 'auto', whiteSpace: 'normal', textAlign: 'left' }}>
              {item.title || `知识试问 · ${formatTime(item.createdAt)}`}<br />{statusLabels[item.status] || item.status}
            </Button>
          </List.Item>} />
          {cursor && <Button block loading={listLoading} onClick={() => { void readList(cursor); }}>加载更多会话</Button>}
        </Card>
      </Col>
      <Col xs={24} lg={17}>
        <Card className="admin-panel-card" title="回答与依据" extra={<Space wrap>
          {conversationId && <Button disabled={busy} onClick={() => setReload(value => value + 1)}>刷新状态</Button>}
          {conversation?.status === 'open' && <Popconfirm title="归档此试问？" description="归档后保留历史，并停止正在生成的回答。" onConfirm={() => operate(async () => { await mutations.current.write(`preview/conversations/${conversationId}`, { action: 'archive', expectedVersion: conversation.version }, 'PATCH'); }, '试问已归档')}><Button disabled={busy || Boolean(pending)}>归档</Button></Popconfirm>}
        </Space>}>
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            {error && <Alert type="error" showIcon message={error} />}
            {loading ? <Skeleton active /> : !conversationId ? <Empty description="新建试问，或选择一个历史会话" /> : conversation && <>
              <Space wrap><Tag>{statusLabels[conversation.status]}</Tag><Typography.Text type="secondary">{audienceLabels[conversation.previewScope?.audience || 'customer_public']} · {conversation.previewScope?.draftVersionIds.length ? `包含 ${conversation.previewScope.draftVersionIds.length} 个固定草稿` : '仅已发布知识'}</Typography.Text></Space>
              {messageCursor && <Button disabled={busy || active} onClick={() => { void older(); }}>查看更早消息</Button>}
              {!messages.length && <Empty description="可以开始提问了" />}
              {messages.map(message => <Card size="small" key={message.id} title={message.authorKind === 'assistant' ? '小 K' : message.authorKind === 'admin' ? '我' : '系统'} extra={<Typography.Text type="secondary">{formatTime(message.createdAt)}</Typography.Text>}>
                {message.answerKind === 'insufficient_evidence' && <Tag color="orange">资料不足</Tag>}
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 12 }}>
                  {message.content.blocks.map(block => block.type === 'text' ? block.text || '' : block.fallbackText || '此内容暂不支持展示。').join('\n')}
                </Typography.Paragraph>
                <Space wrap>{message.citations.map((item, index) => <Button key={item.id} size="small" disabled={!item.available} onClick={() => setCitationId(item.id)}>{item.available ? `${index + 1}. ${item.title}${item.isDraft ? '（草稿）' : ''}` : '来源已不可用'}</Button>)}</Space>
              </Card>)}
              {run && <Alert showIcon type={active ? 'info' : ['failed', 'indeterminate'].includes(run.status) ? 'warning' : 'success'} message={`本轮回答：${statusLabels[run.status]}`} description={run.status === 'indeterminate' ? '模型结果及费用尚待核对，不能自动重试。' : run.errorCode ? assistantError(new AssistantRequestError(run.errorCode, 409)) : undefined} action={<Space>
                {active && <Button disabled={busy} onClick={() => { void operate(async () => { await mutations.current.write(`preview/runs/${run.id}/cancel`, {}); }, '已请求停止回答'); }}>停止回答</Button>}
                {run.retryable && conversation.status === 'open' && <Button disabled={busy} onClick={() => { void operate(async () => { await mutations.current.write(`preview/runs/${run.id}/retry`, {}); }, '已重新发起回答'); }}>重试回答</Button>}
              </Space>} />}
              {run && <RetrievalDiagnostics key={run.id} runId={run.id} />}
            </>}
            {pending && <Alert type="warning" message="上次发送结果尚未确认，文字已保留。重试会沿用同一提交标识。" />}
            {conversationId && <>
              <Input.TextArea aria-label="试问内容" value={question} onChange={e => setQuestion(e.target.value)} disabled={busy || Boolean(pending) || !conversation || conversation.status !== 'open'} rows={4} maxLength={4000} showCount placeholder="输入一个真实客户可能询问的问题" />
              <Button type="primary" loading={busy} disabled={!pending && (!question.trim() || active || !conversation || conversation.status !== 'open')} onClick={() => { void send(); }}>{pending ? '确认上次发送结果' : '发送问题'}</Button>
            </>}
          </Space>
        </Card>
      </Col>
    </Row>
    <Modal title="新建试问" open={createOpen} confirmLoading={busy} closable={!busy} maskClosable={!busy} onCancel={() => { if (!busy) setCreateOpen(false); }} okText="开始试问" onOk={() => operate(async () => {
      const result = await mutations.current.write<PreviewConversation>('preview/conversations', { audience, draftVersionIds: seed ? [seed.draftId] : [] });
      setCreateOpen(false); setConversationId(result.id); setQuestion(''); setPending(null);
      const url = new URL(window.location.href); url.searchParams.set('preview', result.id); window.history.replaceState(null, '', url);
    }, '试问会话已创建')}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Typography.Paragraph>会话创建后使用范围固定；更换范围请新建试问。</Typography.Paragraph>
        <Select aria-label="试问范围" value={audience} onChange={setAudience} disabled={busy || Boolean(seed)} style={{ width: '100%' }} options={Object.entries(audienceLabels).map(([value, label]) => ({ value, label }))} />
        {seed && <Alert type="warning" message="本次包含刚才选择的已就绪草稿，回答与引用会明确标注草稿。" />}
      </Space>
    </Modal>
    <Drawer title="回答依据" open={Boolean(citationId)} onClose={() => setCitationId(null)} width={520}>
      {citationError ? <Alert type="error" message={citationError} /> : !citation ? <Skeleton active /> : !citation.available ? <Alert type="warning" message="该来源当前已不可用，请重新提问。" /> : <Space direction="vertical" size={16}>
        <Typography.Title level={4}>{citation.title}</Typography.Title><Space><Tag>版本 {citation.versionNumber}</Tag>{citation.isDraft && <Tag color="orange">未发布草稿</Tag>}{citation.historical && <Tag>历史版本</Tag>}</Space>
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{citation.quote}</Typography.Paragraph>
      </Space>}
    </Drawer>
  </>;
}
