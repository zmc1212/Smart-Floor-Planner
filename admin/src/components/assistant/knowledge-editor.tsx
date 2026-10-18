'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Divider, Drawer, Form, Image, Input, Popconfirm, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, assistantError, assistantRequest, audienceLabels, formatTime, statusLabels } from './client';
import type { Audience, KnowledgeDetail, KnowledgeVersion } from './contracts';
import { ProfessionalFields } from './professional-fields';

type ContentValues = { body?: string; faq?: Array<{ question: string; answer: string }>; effectiveFrom?: string; effectiveTo?: string; referenceCase?: NonNullable<KnowledgeVersion['reference_case']>; professional?: KnowledgeVersion['professional'] };
type CreateValues = ContentValues & { title: string; category?: string; sourceType: 'manual_text' | 'faq' | 'reference_case'; audience: Audience };
function CaseImageInput({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  const [error, setError] = useState('');
  return <Space direction="vertical">
    <Input type="file" accept="image/png,image/jpeg" onChange={async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024 || !['image/png','image/jpeg'].includes(file.type)) { setError('请选择4MB以内的JPEG或PNG独立案例图片。'); return; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        onChange?.(btoa(binary)); setError('');
      } catch { setError('图片读取失败，请重新选择。'); }
    }} />
    {error && <Typography.Text type="danger">{error}</Typography.Text>}
    {value && <Image alt="授权案例预览" src={`data:image/${value.startsWith('/9j/') ? 'jpeg' : 'png'};base64,${value}`} preview={false} style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }} />}
  </Space>;
}
function localDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function contentBody(values: ContentValues, source: string) {
  const from = values.effectiveFrom ? new Date(values.effectiveFrom).toISOString() : undefined;
  const to = values.effectiveTo ? new Date(values.effectiveTo).toISOString() : null;
  if (from && to && from >= to) throw new Error('结束时间必须晚于开始时间。');
  const body = source !== 'faq' ? values.body || '' : '';
  const faq = source === 'faq' ? values.faq || [] : [];
  const rendered = source === 'faq' ? faq.map(item => `问：${item.question.trim()}\n答：${item.answer.trim()}`).join('\n\n') : body.trim();
  if (rendered.length > 16000 || new TextEncoder().encode(rendered).length > 48000) throw new Error('完整正文最多 16,000 字符 / 48,000 字节，请精简后再保存。');
  const p=values.professional;
  const professional=p?.kind?{...p,version:1,topics:p.topics||[],conditions:p.conditions||[],prerequisites:p.prerequisites||[],exceptions:p.exceptions||[],claim:p.claim?.key||p.claim?.value?p.claim:null}:null;
  return { body, faq, ...(source === 'reference_case' ? { referenceCase: values.referenceCase } : {professional}), ...(from ? { effectiveFrom: from } : {}), effectiveTo: to };
}
function ContentFields({ source }: { source: string }) {
  return <>
    {source !== 'reference_case' && <Collapse items={[{key:'professional',label:'专业条目、适用条件与来源审校',forceRender:true,children:<ProfessionalFields />}]} />}
    {source === 'reference_case' && <>
      <Alert type="info" showIcon message="仅发布已取得授权的独立案例图片" description="填写原始出处及可核验的授权/许可凭据；发布前人工核实，不得使用客户私图或把参考当正式施工方案。撤回会令历史引用及图片入口失效。" />
      <Form.Item name={['referenceCase','source']} label="案例出处与作者" rules={[{ required: true, whitespace: true, max: 500 }]}><Input placeholder="原始链接/文件、作者及案例出处" maxLength={500} /></Form.Item>
      <Form.Item name={['referenceCase','authorization']} label="授权或许可凭据" rules={[{ required: true, whitespace: true, max: 500 }]}><Input placeholder="授权记录编号、许可类型及证据位置" maxLength={500} /></Form.Item>
      <Form.Item name={['referenceCase','tags']} label="方向标签" rules={[{ required: true, type: 'array', min: 1, max: 12 }]}><Select mode="tags" tokenSeparators={['，', ',']} placeholder="如：小户型、原木、收纳；用于匹配客户方向" /></Form.Item>
      <Form.Item name={['referenceCase','imageBase64']} label="独立案例图片" rules={[{ required: true }]} extra="保存时去除元数据，转为最长边1200px、300KB以内JPEG；不上传至公共图片地址。"><CaseImageInput /></Form.Item>
    </>}
    {source === 'faq' ? <Form.List name="faq" rules={[{ validator: async (_, items) => { if (!items?.length || items.length > 100) throw new Error('请填写 1–100 条问答'); } }]}>
      {(fields, { add, remove }, { errors }) => <>
        {fields.map(({ key, name, ...rest }) => <div key={key}>
          <Form.Item {...rest} name={[name, 'question']} label={`问题 ${name + 1}`} rules={[{ required: true, whitespace: true, max: 500 }]}><Input maxLength={500} /></Form.Item>
          <Form.Item {...rest} name={[name, 'answer']} label="答案" rules={[{ required: true, whitespace: true, max: 4000 }]}><Input.TextArea rows={3} maxLength={4000} showCount /></Form.Item>
          <Button danger onClick={() => remove(name)}>移除这条问答</Button><Divider />
        </div>)}
        <Button onClick={() => add({ question: '', answer: '' })} disabled={fields.length >= 100}>添加问答</Button>
        <Form.ErrorList errors={errors} />
      </>}
    </Form.List> : <Form.Item name="body" label={source === 'reference_case' ? '参考方向说明' : '知识正文'} rules={[{ required: true, whitespace: true, max: source === 'reference_case' ? 400 : 16000 }]}><Input.TextArea rows={source === 'reference_case' ? 4 : 12} maxLength={source === 'reference_case' ? 400 : 16000} showCount placeholder={source === 'reference_case' ? '描述该案例适合讨论的方向，不承诺报价、工期或适用于客户家' : '填写可核实的服务说明、流程或规则'} /></Form.Item>}
    <Divider />
    <Form.Item name="effectiveFrom" label="生效时间（本地时间）" extra="新建时留空代表立即生效。"><Input type="datetime-local" /></Form.Item>
    <Form.Item name="effectiveTo" label="失效时间（可选）"><Input type="datetime-local" /></Form.Item>
  </>;
}

export function KnowledgeEditor({ documentId, onClose, onChanged, onPreview }: {
  documentId: string; onClose: () => void; onChanged: () => void; onPreview: (draftId: string, audience: Audience) => void;
}) {
  const isNew = documentId === 'new';
  const [form] = Form.useForm<CreateValues>();
  const [metadata] = Form.useForm<{ title: string; category: string; audience: Audience }>();
  const source = Form.useWatch('sourceType', form) || 'manual_text';
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirtyArea, setDirtyArea] = useState<'metadata' | 'content' | null>(null);
  const dirty = dirtyArea !== null;
  const [job, setJob] = useState<{ id: string; status: string; last_error?: string | null } | null>(null);
  const mutations = useRef(new AssistantMutations());
  const lock = useRef(false);
  const version = detail?.versions.find(item => String(item.id) === selectedVersion) || detail?.versions[0];
  const indexing = Boolean(detail?.versions.some(item => item.index_status === 'indexing'));
  const jobId = job?.id;

  const read = useCallback(async (signal?: AbortSignal) => {
    const result = await assistantRequest<KnowledgeDetail>(`knowledge/documents/${documentId}`, { signal });
    if (!signal?.aborted) setDetail(result);
    return result;
  }, [documentId]);
  useEffect(() => {
    if (isNew) return;
    const controller = new AbortController();
    void read(controller.signal).catch(e => { if (!controller.signal.aborted) setError(assistantError(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isNew, read]);
  useEffect(() => {
    if (!detail || !version || dirty) return;
    metadata.setFieldsValue(detail.document);
    form.setFieldsValue({ body: version.body, faq: version.faq, referenceCase: version.reference_case || undefined, professional:version.professional || {kind:undefined} as unknown as KnowledgeVersion['professional'], effectiveFrom: localDate(version.effective_from), effectiveTo: localDate(version.effective_to) });
  }, [detail, version, form, metadata, dirty]);
  useEffect(() => {
    if (!indexing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (jobId) {
          const current = await assistantRequest<{ id: string; status: string; last_error?: string }>(`knowledge/jobs/${jobId}`, { signal: controller.signal });
          if (!controller.signal.aborted) setJob(current);
        }
        await read(controller.signal);
      } catch (e) { if (!controller.signal.aborted) setError(assistantError(e)); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [indexing, jobId, read]);

  const action = async (work: () => Promise<unknown>, message: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await work(); setDirtyArea(null); notify.success(message); onChanged();
      if (isNew) onClose();
      else await read();
    } catch (e) { setError(assistantError(e)); notify.error(assistantError(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  const close = () => { if (!busy && (!dirty || window.confirm('有未保存内容，确认关闭并放弃修改？'))) onClose(); };
  const versionPath = `knowledge/documents/${documentId}/versions/${version?.id}`;
  const switchVersion = (value: string) => {
    if (dirty && !window.confirm('切换版本将放弃未保存修改，是否继续？')) return;
    setDirtyArea(null); setSelectedVersion(value); setError(''); setJob(null);
  };
  return <Drawer open width={720} title={isNew ? '新建知识' : detail?.document.title || '知识详情'} onClose={close} maskClosable={!dirty && !busy} closable={!busy}>
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} action={!isNew && <Button disabled={busy} onClick={() => { if (!dirty || window.confirm('重新读取将放弃未保存修改，是否继续？')) void action(() => read(), '已重新读取资料'); }}>重新读取</Button>} />}
      {loading ? <Skeleton active /> : isNew ? <Form form={form} layout="vertical" initialValues={{ sourceType: 'manual_text', audience: 'customer_public', faq: [{ question: '', answer: '' }] }} disabled={busy} onValuesChange={() => setDirtyArea('content')} onFinish={values => { void action(() => mutations.current.write('knowledge/documents', { title: values.title, category: values.category || '', sourceType: values.sourceType, audience: values.audience, ...contentBody(values, values.sourceType) }), '知识草稿已创建'); }}>
        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, max: 200 }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="category" label="分类"><Input maxLength={100} /></Form.Item>
        <Form.Item name="audience" label="使用范围"><Select options={Object.entries(audienceLabels).filter(([value]) => value !== 'all').map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="sourceType" label="内容类型"><Select options={[{ value: 'manual_text', label: '服务说明' }, { value: 'faq', label: '常见问答' }, { value: 'reference_case', label: '授权参考案例' }]} /></Form.Item>
        <ContentFields source={source} />
        <Button type="primary" htmlType="submit" loading={busy}>保存草稿</Button>
      </Form> : detail && version && <>
        <Space wrap><Tag>{statusLabels[detail.document.status]}</Tag><Typography.Text type="secondary">最近更新 {formatTime(detail.document.updated_at)}</Typography.Text></Space>
        <Form form={metadata} layout="vertical" disabled={busy || dirtyArea === 'content'} onValuesChange={() => setDirtyArea('metadata')} onFinish={values => { void action(() => mutations.current.write(`knowledge/documents/${documentId}`, { ...values, expectedVersion: detail.document.version }, 'PATCH'), '知识信息已保存'); }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, max: 200 }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="category" label="分类"><Input maxLength={100} /></Form.Item>
          <Form.Item name="audience" label="使用范围" extra="范围变更会立即影响检索及历史引用的可见性。"><Select options={Object.entries(audienceLabels).filter(([value]) => value !== 'all').map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Button htmlType="submit" loading={busy}>保存知识信息</Button>
        </Form>
        <Divider style={{ margin: 0 }} />
        <Select aria-label="知识版本" value={String(version.id)} disabled={busy} onChange={switchVersion} style={{ width: '100%' }} options={detail.versions.map(item => ({ value: String(item.id), label: `版本 ${item.version_number} · ${String(item.id) === String(detail.document.published_version_id) ? '当前发布' : item.published_at ? '历史发布' : '草稿'} · ${statusLabels[item.index_status]}` }))} />
        <Space wrap><Tag>{statusLabels[version.index_status]}</Tag><Typography.Text type="secondary">{version.chunk_count} 个知识片段</Typography.Text></Space>
        {job && <Alert type={job.status === 'failed' ? 'error' : 'info'} showIcon message={`索引任务：${statusLabels[job.status] || '待确认'}`} description={job.last_error ? '索引未完成，请检查服务后重新保存草稿再建立索引。' : undefined} />}
        {version.published_at && <Alert type="info" message="已发布正文只读。需要修改时，请复制为新草稿；旧版本会继续服务直到新版本发布。" />}
        <Form form={form} layout="vertical" disabled={busy || dirtyArea === 'metadata' || Boolean(version.published_at) || version.index_status === 'indexing'} onValuesChange={() => setDirtyArea('content')} onFinish={values => { void action(() => mutations.current.write(versionPath, { ...contentBody(values, detail.document.source_type), expectedEditVersion: version.edit_version }, 'PATCH'), '草稿正文已保存，请重新建立索引'); }}>
          <ContentFields source={detail.document.source_type} />
          {!version.published_at && <Button type="primary" htmlType="submit" loading={busy}>保存正文与有效期</Button>}
        </Form>
        <Space wrap>
          {detail.document.source_type === 'reference_case' && detail.document.status === 'active' && detail.document.audience === 'customer_public' && <Button disabled={busy || dirty} onClick={() => { void action(async () => {
            const entry=await mutations.current.write<{path:string}>(`knowledge/documents/${documentId}/share`,{expectedVersion:detail.document.version});
            await navigator.clipboard.writeText(entry.path);
          }, '已复制7天有效的小程序咨询路径；只包含授权案例来源，不包含客户对话'); }}>复制案例咨询入口</Button>}
          <Button disabled={busy || dirty} onClick={() => { void action(async () => { const draft = await mutations.current.write<KnowledgeVersion>(`knowledge/documents/${documentId}/versions`, { fromVersionId: String(version.id), expectedVersion: detail.document.version }); setSelectedVersion(String(draft.id)); }, '已复制为新草稿'); }}>复制为新草稿</Button>
          {!version.published_at && <Button disabled={busy || dirty || detail.document.status === 'retired' || version.index_status === 'indexing'} onClick={() => { void action(async () => { const result = await mutations.current.write<{ jobId: string; status: string }>(`${versionPath}/index`, { expectedEditVersion: version.edit_version }); setJob({ id: result.jobId, status: result.status }); if (['failed', 'cancelled', 'indeterminate'].includes(result.status)) throw new Error('该草稿的索引任务未完成。请重新保存正文后建立索引，结果待核对的任务需先由管理员核对。'); }, '索引任务已确认，请查看任务状态'); }}>建立索引</Button>}
          {!version.published_at && detail.document.source_type !== 'reference_case' && <Button disabled={busy || dirty || detail.document.status === 'retired' || version.index_status !== 'ready'} onClick={() => onPreview(String(version.id), detail.document.audience)}>试问此草稿</Button>}
          <Popconfirm title="将此版本用于后续回答？" description="发布后会替换当前引用依据；有效期与权限仍由服务端检查。" onConfirm={() => action(() => mutations.current.write(`${versionPath}/publish`, { expectedVersion: detail.document.version, expectedEditVersion: version.edit_version }), '知识版本已发布')}>
            <Button type="primary" disabled={busy || dirty || version.index_status !== 'ready' || (detail.document.status === 'active' && String(detail.document.published_version_id) === String(version.id))}>发布此版本</Button>
          </Popconfirm>
          <Popconfirm title="撤回整份知识？" description="所有版本立即停止参与回答，相关历史引用将不可用。" onConfirm={() => action(() => mutations.current.write(`knowledge/documents/${documentId}/retire`, { expectedVersion: detail.document.version }), '知识已撤回')}>
            <Button danger disabled={busy || dirty || detail.document.status === 'retired'}>撤回知识</Button>
          </Popconfirm>
        </Space>
        {dirty && <Typography.Text type="warning">有未保存修改，请先保存对应表单再索引、试问或发布。</Typography.Text>}
      </>}
    </Space>
  </Drawer>;
}
