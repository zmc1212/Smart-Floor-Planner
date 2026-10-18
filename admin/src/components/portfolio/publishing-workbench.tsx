'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Col, Drawer, Empty, Form, Image, Input, Modal, Result, Row, Select, Skeleton, Space, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { notify } from '@/components/admin/operation-feedback';
import { STYLE_OPTIONS } from '@/lib/portfolio/options';
import { CITY_OPTIONS, cityNameFor, districtOptions } from '@/lib/portfolio/regions';
import { PortfolioMutations, assetUrl, errorText, portfolioRequest, statusLabels, type WorkRow, type Author, type Profile } from './client';

type CommunityRequest = { id: string; name: string; city_name: string; city_code: string; district: string; address: string; status: string; review_note: string; community_id: string | null };
function Profiles({ authors }: { authors: Author[] }) {
  const [selected, setSelected] = useState<string>(), [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [version, setVersion] = useState(0), [works, setWorks] = useState<WorkRow[]>([]);
  const [form] = Form.useForm(); const mutations = useRef(new PortfolioMutations());
  const edit = async (id: string) => {
    setSelected(id); setOpen(true); setLoading(true);
    try {
      const [profile, list] = await Promise.all([portfolioRequest<Profile>('profiles/' + id), portfolioRequest<{ items: WorkRow[] }>('works?authorId=' + id + '&limit=100')]);
      form.setFieldsValue(profile.content); setVersion(profile.version); setWorks(list.items);
    } catch (error) { notify.error('读取失败', { description: errorText(error) }); setOpen(false); } finally { setLoading(false); }
  };
  return <Card title="设计师本人作品集资料"><Alert type="info" showIcon message="真实姓名与职业背书沿用员工资料；本处只维护自述、服务范围、擅长风格和精选作品。" style={{ marginBottom: 16 }} />
    <ProTable<Author> rowKey="id" search={false} options={false} pagination={false} dataSource={authors} columns={[
      { title: '设计师', dataIndex: 'display_name', render: (_, a) => a.display_name || '未填写姓名' },
      { title: '职业背书', dataIndex: 'professional_title', render: (_, a) => a.professional_title || '未设置' },
      { title: '操作', valueType: 'option', render: (_, a) => <Button type="link" onClick={() => void edit(String(a.id))}>维护作品集</Button> },
    ]} />
    <Drawer title="维护设计师作品集" open={open} width={680} destroyOnHidden onClose={() => setOpen(false)} extra={<Button type="primary" loading={loading} onClick={async () => {
      try { await form.validateFields(); const content = form.getFieldsValue(true); setLoading(true); const result = await mutations.current.write<Profile>('profiles/' + selected, { expectedVersion: version, content }, 'PUT'); setVersion(result.version); notify.success('作品集资料已保存'); }
      catch (error) { if (error instanceof Error) notify.error('保存失败', { description: errorText(error) }); } finally { setLoading(false); }
    }}>保存</Button>}>
      <Form form={form} layout="vertical" disabled={loading}>
        <Form.Item name="bio" label="设计师自述"><Input.TextArea maxLength={500} rows={4} showCount /></Form.Item>
        <Form.Item name="styles" label="擅长风格（最多8个）"><Select mode="tags" maxCount={8} options={STYLE_OPTIONS.map(value => ({ value, label: value }))} /></Form.Item>
        <Typography.Title level={5}>服务城市与区县</Typography.Title>
        <Form.List name="cities">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%' }}>{fields.map(field => <Card key={field.key} size="small" extra={<Button type="link" danger onClick={() => remove(field.name)}>移除</Button>}>
          <Form.Item name={[field.name, 'code']} label="服务城市" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={CITY_OPTIONS} placeholder="搜索并选择城市" onChange={code => { form.setFieldValue(['cities', field.name, 'name'], cityNameFor(code)); form.setFieldValue(['cities', field.name, 'districts'], []); }} /></Form.Item>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Form.Item name={[field.name, 'districts']} label="服务区县（留空表示全市）"><Select mode="multiple" showSearch optionFilterProp="label" options={districtOptions(getFieldValue(['cities', field.name, 'code']) || '')} /></Form.Item>}</Form.Item>
        </Card>)}{fields.length < 10 && <Button onClick={() => add({ code: '', name: '', districts: [] })} icon={<PlusOutlined />}>添加服务城市</Button>}</Space>}</Form.List>
        <Form.Item name="featuredWorkIds" label="精选作品及顺序（最多12个）" extra="按选择顺序展示；下架或许可失效的作品不会公开。" style={{ marginTop: 20 }}><Select mode="multiple" maxCount={12} options={works.filter(w => w.kind === 'designer_work').map(w => ({ value: w.id, label: w.content.title || '未命名作品' }))} /></Form.Item>
      </Form>
    </Drawer>
  </Card>;
}
function CommunityRequests({ manager }: { manager: boolean }) {
  const [items, setItems] = useState<CommunityRequest[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState<CommunityRequest | null>(null);
  const [form] = Form.useForm(); const mutations = useRef(new PortfolioMutations());
  const load = useCallback(async () => { setLoading(true); setError(''); try { setItems((await portfolioRequest<{ items: CommunityRequest[] }>('communities/requests')).items); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <Card title="小区核验补录" extra={<Button onClick={() => void load()}>刷新</Button>}>
    <Alert type="info" showIcon message="没有标准小区不影响作品保存和发布。补录须依据企业自有核验信息或许可明确的名录；不得按名称自动合并分期。" style={{ marginBottom: 16 }} />
    {error && <Alert type="error" message={error} />}
    <ProTable<CommunityRequest> rowKey="id" search={false} options={false} loading={loading} pagination={{ pageSize: 10 }} dataSource={items} columns={[
      { title: '城市 / 小区', render: (_, item) => <Space direction="vertical" size={0}><Typography.Text>{item.name}</Typography.Text><Typography.Text type="secondary">{item.city_name} · {item.district} · {item.address}</Typography.Text></Space> },
      { title: '核验状态', dataIndex: 'status', render: (_, item) => ({ pending: '待核验', approved: '已核验', rejected: '已退回' }[item.status] || item.status) },
      { title: '核验说明', dataIndex: 'review_note' },
      { title: '操作', valueType: 'option', render: (_, item) => manager && item.status === 'pending' ? <Button type="link" onClick={() => { form.resetFields(); setSelected(item); }}>核对</Button> : null },
    ]} />
    <Modal title="核验小区补录" open={!!selected} confirmLoading={loading} onCancel={() => setSelected(null)} footer={<Space><Button onClick={() => setSelected(null)}>取消</Button>{[false, true].map(approve => <Button key={String(approve)} type={approve ? 'primary' : 'default'} loading={loading} onClick={async () => {
      try { const values = await form.validateFields(); setLoading(true); await mutations.current.write(`communities/requests/${selected!.id}/review`, { approve, note: values.note, ...(values.existingCommunityId ? { existingCommunityId: values.existingCommunityId } : {}) }); notify.success(approve ? '小区已核验' : '已退回补录申请'); setSelected(null); await load(); } catch (e) { if (e instanceof Error) notify.error('操作失败', { description: errorText(e) }); } finally { setLoading(false); }
    }}>{approve ? '核验通过' : '退回'}</Button>)}</Space>}>
      <Typography.Paragraph>{selected?.city_name} · {selected?.district} · {selected?.name}<br />{selected?.address}</Typography.Paragraph>
      <Form form={form} layout="vertical"><Form.Item name="note" label="核验依据与许可 / 退回原因" rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item><Form.Item name="existingCommunityId" label="关联已有标准小区ID（可选）" extra="仅在核对同一小区和具体分期后填写，否则保留为空并建立独立记录。"><Input inputMode="numeric" /></Form.Item></Form>
    </Modal>
  </Card>;
}
export function PublishingWorkbench() {
  const { user, isLoading } = useCurrentUser(), router = useRouter();
  const [items, setItems] = useState<WorkRow[]>([]), [authors, setAuthors] = useState<Author[]>([]), [manager, setManager] = useState(false), [tab, setTab] = useState('works'), [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState<WorkRow | null>(null), [creating, setCreating] = useState(false), [createOpen, setCreateOpen] = useState(false), [hasMore, setHasMore] = useState(false);
  const [filters] = Form.useForm(), [createForm] = Form.useForm(); const mutations = useRef(new PortfolioMutations());
  const canAccess = !!user && ['super_admin', 'admin', 'enterprise_admin', 'designer'].includes(user.role || '') && (['super_admin', 'admin'].includes(user.role || '') || !!user.effectivePermissions?.includes('case-publishing'));
  const load = useCallback(async (more = false) => {
    if (!canAccess) return; setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '20', ...(status ? { status } : {}) });
      for (const [key, value] of Object.entries(filters.getFieldsValue())) if (typeof value === 'string' && value) params.set(key, value);
      if (more && items.length) params.set('beforeId', items[items.length - 1].id);
      const [result, staff] = await Promise.all([portfolioRequest<{ items: WorkRow[]; manager: boolean }>('works?' + params), portfolioRequest<{ items: Author[] }>('authors')]);
      setItems(old => more ? [...old, ...result.items] : result.items); setAuthors(staff.items); setManager(result.manager); setHasMore(result.items.length === 20);
      if (!more) setSelected(result.items[0] || null);
    } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [canAccess, filters, items, status]);
  // Explicit loads only: no polling or reload loop when the list changes.
  const loader = useRef(load); loader.current = load;
  useEffect(() => { void loader.current(); }, [canAccess, status]);
  if (isLoading) return <PageContainer title="案例发布管理"><Skeleton active /></PageContainer>;
  if (!canAccess) return <Result status="403" title="当前账号未获案例管理权限" subTitle="请由企业管理员核对角色菜单权限。" />;
  const columns: ProColumns<WorkRow>[] = [
    { title: '作品', dataIndex: 'title', width: 270, render: (_, w) => <Space align="start">{w.content.coverAssetId && <Image width={96} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} src={assetUrl(w.id, w.content.coverAssetId)} alt="作品封面" />}<Space direction="vertical" size={2}><Link href={'/case-publishing/' + w.id}>{w.content.title || '未命名作品'}</Link><Typography.Text type="secondary">{w.kind === 'enterprise_reference' ? '企业授权参考' : w.author_name || '设计师作品'}</Typography.Text><Typography.Text type="secondary">{w.content.description.slice(0, 45)}</Typography.Text></Space></Space> },
    { title: '风格与小区', width: 150, render: (_, w) => <Space direction="vertical" size={2}><Typography.Text>{w.content.primaryStyle || '待选风格'}</Typography.Text><Typography.Text type="secondary">{w.content.cityName || '未选城市'} · {w.content.communityId ? '已绑小区' : '暂未绑定'}</Typography.Text></Space> },
    { title: '图片', width: 110, render: (_, w) => <Space direction="vertical" size={0}><Typography.Text>效果图 {w.content.images.filter(i => i.kind === 'render').length}</Typography.Text><Typography.Text>实拍图 {w.content.images.filter(i => i.kind === 'photo').length}</Typography.Text></Space> },
    { title: '状态', width: 100, render: (_, w) => <Space direction="vertical" size={2}><Tag color={w.withdrawn ? 'default' : w.status === 'submitted' ? 'gold' : w.status === 'published' ? 'green' : 'default'}>{statusLabels[w.withdrawn ? 'withdrawn' : w.status]}</Tag>{!!w.published_version_id && w.status !== 'published' && !w.withdrawn && <Typography.Text type="secondary">旧版有效</Typography.Text>}</Space> },
    { title: '操作', valueType: 'option', width: 110, render: (_, w) => <Link href={'/case-publishing/' + w.id}>{manager && w.status === 'submitted' ? '审核发布' : ['draft', 'returned'].includes(w.status) ? '编辑' : '查看'}</Link> },
  ];
  return <PageContainer title="案例发布管理" subTitle={manager ? '企业审核与发布；设计师作品和企业授权参考分别管理。' : '维护本人作品，提交企业审核后发布。'} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>新建案例</Button>}>
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'works', label: '作品管理' }, { key: 'profiles', label: '设计师作品集' }, { key: 'communities', label: '小区核验' }]} />
    {error && <Alert type="error" message={error} action={<Button onClick={() => void load()}>重试</Button>} style={{ marginBottom: 16 }} />}
    {tab === 'works' && <Row gutter={[20, 20]}><Col xs={24} xl={18}>
      <Tabs activeKey={status} onChange={setStatus} items={[['', '全部作品'], ['submitted', '待审核'], ['published', '已发布'], ['draft', '草稿'], ['returned', '已退回'], ['withdrawn', '已下架']].map(([key, label]) => ({ key, label }))} />
      <Card style={{ marginBottom: 16 }}><Form form={filters} layout="inline" onFinish={() => void load()} style={{ gap: 12 }}>
        <Form.Item name="query" label="作品"><Input placeholder="名称" allowClear style={{ width: 130 }} /></Form.Item><Form.Item name="style" label="风格"><Select allowClear options={STYLE_OPTIONS.map(value => ({ value, label: value }))} style={{ width: 120 }} /></Form.Item>
        {manager && <Form.Item name="authorId" label="设计师"><Select allowClear options={authors.map(a => ({ value: String(a.id), label: a.display_name || '未填姓名' }))} style={{ width: 120 }} /></Form.Item>}
        <Form.Item name="kind" label="类型"><Select allowClear style={{ width: 140 }} options={[{ value: 'designer_work', label: '设计师作品' }, { value: 'enterprise_reference', label: '企业授权参考' }]} /></Form.Item><Button htmlType="submit" type="primary" loading={loading}>搜索作品</Button>
      </Form></Card>
      <ProTable<WorkRow> rowKey="id" search={false} options={false} loading={loading} pagination={false} dataSource={items} columns={columns} scroll={{ x: 790 }} rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_, rows) => setSelected(rows[0] || null) }} />
      {hasMore && <Button loading={loading} style={{ marginTop: 16 }} onClick={() => void load(true)}>加载更多</Button>}
    </Col><Col xs={24} xl={6}><Card title="发布检查">{selected ? <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {selected.content.coverAssetId && <Image src={assetUrl(selected.id, selected.content.coverAssetId)} width="100%" alt="所选作品" style={{ borderRadius: 8 }} />}
      <Typography.Title level={5} style={{ margin: 0 }}>{selected.content.title || '未命名作品'}</Typography.Title>
      <Typography.Text>作品类型：{selected.kind === 'designer_work' ? '设计师作品' : '企业授权参考'}</Typography.Text><Typography.Text>图片许可：{selected.content.authorization ? '已填写，待人工核对' : '待补充'}</Typography.Text>
      <Typography.Text>小区：{selected.content.communityId ? '已选择标准记录' : '可暂不绑定'}</Typography.Text>
      <Button type="primary" block onClick={() => router.push('/case-publishing/' + selected.id)}>{manager && selected.status === 'submitted' ? '核对并发布' : '查看作品'}</Button>
      <Typography.Text type="secondary">审核凭据与私人信息不进入公开内容。首版仅后台维护作品。</Typography.Text>
    </Space> : <Empty description="暂无作品" />}</Card></Col></Row>}
    {tab === 'profiles' && <Profiles authors={authors} />}{tab === 'communities' && <CommunityRequests manager={manager} />}
    <Modal open={createOpen} title="新建案例" confirmLoading={creating} onCancel={() => setCreateOpen(false)} onOk={async () => {
      try { const values = await createForm.validateFields(); setCreating(true); const kind = values.kind || 'designer_work'; const result = await mutations.current.write<{ id: string }>('works', { kind, ...(kind === 'designer_work' ? { authorId: values.authorId || String(authors[0]?.id) } : {}), content: { title: values.title || '', ...(kind === 'enterprise_reference' ? { showOnProfile: false } : {}) } }); notify.success('草稿已创建'); router.push('/case-publishing/' + result.id); }
      catch (e) { if (e instanceof Error) notify.error('创建失败', { description: errorText(e) }); } finally { setCreating(false); }
    }}>
      <Form form={createForm} layout="vertical" initialValues={{ kind: 'designer_work', title: '' }}>
        {manager && <Form.Item name="kind" label="内容类型"><Select options={[{ value: 'designer_work', label: '设计师作品' }, { value: 'enterprise_reference', label: '企业授权参考' }]} /></Form.Item>}
        <Form.Item noStyle shouldUpdate={(a, b) => a.kind !== b.kind}>{({ getFieldValue }) => manager && getFieldValue('kind') !== 'enterprise_reference' ? <Form.Item name="authorId" label="真实设计师作者" rules={[{ required: true }]}><Select options={authors.map(a => ({ value: String(a.id), label: a.display_name || '未填姓名' }))} /></Form.Item> : null}</Form.Item>
        <Form.Item name="title" label="作品名称"><Input maxLength={50} /></Form.Item><Typography.Text type="secondary">旧知识库参考不会自动转为本人的原创作品。</Typography.Text>
      </Form>
    </Modal>
  </PageContainer>;
}
