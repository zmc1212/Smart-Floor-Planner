'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { Alert, Button, Card, Checkbox, Col, Drawer, Empty, Flex, Form, Image, Input, Modal, Result, Row, Select, Skeleton, Space, Spin, Tabs, Tag, Typography, Upload } from 'antd';
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { notify } from '@/components/admin/operation-feedback';
import { DEFAULT_PORTFOLIO_AVATAR, LAYOUT_OPTIONS, PORTFOLIO_DEFAULT_AVATARS, STYLE_OPTIONS } from '@/lib/portfolio/options';
import { CITY_OPTIONS, cityNameFor, districtOptions } from '@/lib/portfolio/regions';
import { PORTFOLIO_TEMPLATES } from '@/lib/portfolio/templates';
import { PortfolioMutations, assetUrl, errorText, portfolioRequest, statusLabels, templateAssetUrl, type WorkRow, type Author, type Profile, type TemplateRow, type TemplateDetail } from './client';
import { PortfolioPortrait, ProfileContactEditor, contactDraft, type ContactDraft } from './profile-contact-editor';

type CommunityRequest = { id: string; name: string; city_name: string; city_code: string; district: string; address: string; status: string; review_note: string; community_id: string | null };
function imageFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
function Profiles({ authors, currentUserId }: { authors: Author[]; currentUserId: string }) {
  const [selected, setSelected] = useState<string>(), [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [version, setVersion] = useState(0), [works, setWorks] = useState<WorkRow[]>([]);
  const [portraitAvailable, setPortraitAvailable] = useState(false), [portraitToken, setPortraitToken] = useState(0), [consent, setConsent] = useState(false), [portraitBusy, setPortraitBusy] = useState(false);
  const [form] = Form.useForm(); const mutations = useRef(new PortfolioMutations());
  const [saving, setSaving] = useState(false), [tab, setTab] = useState('profile'), [readingQr, setReadingQr] = useState(false);
  const [contact, setContact] = useState(contactDraft);
  const editSequence = useRef(0), [editorSequence, setEditorSequence] = useState(0);
  const cities = Form.useWatch('cities', form) as Array<{ name: string }> | undefined;
  const defaultAvatar = Form.useWatch('defaultAvatar', form);
  const author = authors.find(a => String(a.id) === selected), isSelf = Boolean(selected) && String(author?.id) === currentUserId;
  const portrait = portraitAvailable && selected ? `/api/portfolio/profiles/${selected}/portrait` : undefined;
  const avatarOption = PORTFOLIO_DEFAULT_AVATARS.find(option => option.value === defaultAvatar) ?? PORTFOLIO_DEFAULT_AVATARS[0];
  const fallbackPortrait = `/portfolio-avatars/${avatarOption.file}`;
  const close = () => { editSequence.current += 1; setOpen(false); };
  const edit = async (id: string) => {
    const sequence = ++editSequence.current;
    setSelected(id); setEditorSequence(sequence); setOpen(true); setLoading(true); setReadingQr(false);
    setTab('profile'); setContact(contactDraft()); form.resetFields();
    setPortraitAvailable(Boolean(authors.find(a => String(a.id) === id)?.portrait_available)); setPortraitToken(0); setConsent(false);
    try {
      const [profile, list] = await Promise.all([portfolioRequest<Profile>('profiles/' + id), portfolioRequest<{ items: WorkRow[] }>('works?authorId=' + id + '&limit=100')]);
      if (sequence !== editSequence.current) return;
      form.setFieldsValue(profile.content); setVersion(profile.version); setWorks(list.items); setContact(contactDraft(profile.contact));
    } catch (error) {
      if (sequence === editSequence.current) { notify.error('读取失败', { description: errorText(error) }); close(); }
    } finally { if (sequence === editSequence.current) setLoading(false); }
  };
  const changeContact = (patch: Partial<ContactDraft>) => {
    if (editorSequence === editSequence.current) setContact(current => ({ ...current, ...patch }));
  };
  const readQr = async (file: File) => {
    setReadingQr(true);
    try { return await imageFile(file); }
    finally { if (editorSequence === editSequence.current) setReadingQr(false); }
  };
  const saveProfile = async () => {
    if (!selected || loading || saving || portraitBusy || readingQr) return;
    setSaving(true);
    try {
      await form.validateFields();
      const nextContact = contact.dirty ? {
        wechatId: contact.wechatId, phone: contact.phone, publishWechat: contact.publishWechat,
        publishPhone: contact.publishPhone, allowInApp: contact.allowInApp, consent: contact.consent,
        ...(contact.stagedQr !== undefined ? { qrImageBase64: contact.stagedQr?.imageBase64 ?? null } : {}),
      } : undefined;
      const result = await mutations.current.write<Profile>('profiles/' + selected, {
        expectedVersion: version, content: form.getFieldsValue(true), ...(nextContact ? { contact: nextContact } : {}),
      }, 'PUT');
      form.setFieldsValue(result.content); setVersion(result.version); setContact(contactDraft(result.contact));
      notify.success('作品集资料已保存');
    } catch (error) {
      if (error instanceof Error) notify.error('保存失败', { description: errorText(error) });
    } finally { setSaving(false); }
  };
  const savePortrait = async (file: File) => {
    if (!consent) { notify.error('无法上传头像', { description: '请先勾选本人同意在小程序公开展示此头像。' }); return false; }
    if (file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) { notify.error('无法上传头像', { description: '请选择4MB以内的PNG/JPEG图片。' }); return false; }
    setPortraitBusy(true);
    try {
      await mutations.current.write('profiles/' + selected + '/portrait', { imageBase64: await imageFile(file), consent: true }, 'PUT');
      setPortraitAvailable(true); setPortraitToken(Date.now()); notify.success('头像已保存', { description: '公开读取时仅返回 JPEG 图片。' });
    } catch (error) { notify.error('头像保存失败', { description: errorText(error) }); } finally { setPortraitBusy(false); }
    return false;
  };
  const removePortrait = async () => {
    setPortraitBusy(true);
    try { await mutations.current.write('profiles/' + selected + '/portrait', {}, 'DELETE'); setPortraitAvailable(false); setConsent(false); notify.success('头像已移除', { description: '公开页面将回退显示姓名首字。' }); }
    catch (error) { notify.error('移除失败', { description: errorText(error) }); } finally { setPortraitBusy(false); }
  };
  return <Card title="设计师作品集资料"><Alert type="info" showIcon message="维护设计师的自述、服务范围、精选作品和获准公开的工作联系方式。" style={{ marginBottom: 16 }} />
    <ProTable<Author> rowKey="id" search={false} options={false} pagination={false} dataSource={authors} columns={[
      { title: '设计师', dataIndex: 'display_name', render: (_, a) => a.display_name || '未填写姓名' },
      { title: '职业背书', dataIndex: 'professional_title', render: (_, a) => a.professional_title || '未设置' },
      { title: '操作', valueType: 'option', render: (_, a) => <Button type="link" onClick={() => void edit(String(a.id))}>维护作品集</Button> },
    ]} />
    <Drawer title="维护设计师作品集" open={open} width={560} destroyOnHidden onClose={close} closable={!saving && !portraitBusy}
      maskClosable={!saving && !portraitBusy} keyboard={!saving && !portraitBusy} footer={<Flex gap={12}>
        <Button block disabled={saving || portraitBusy} onClick={close}>取消</Button>
        <Button block type="primary" loading={saving} disabled={loading || portraitBusy || readingQr} onClick={() => void saveProfile()}>保存资料</Button>
      </Flex>}>
      <Space size={14}>
        <PortfolioPortrait key={portraitToken} size={54} portrait={portrait} fallback={fallbackPortrait} />
        <Flex vertical><Typography.Text strong>{author?.display_name}</Typography.Text>
          <Typography.Text type="secondary">{author?.professionalTitle}</Typography.Text></Flex>
      </Space>
      <Spin spinning={loading}>
      <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'profile', label: '基本资料', forceRender: true, children:
      <Form form={form} layout="vertical" disabled={loading || saving}>
        <Typography.Paragraph type="secondary">职业资料：{author?.professionalTitle || author?.professional_title || '未设置'} · {author?.experienceLabel || '从业年限未设置'}（由员工职业资料维护，本处只读）</Typography.Paragraph>
        <Card size="small" title="公开头像" style={{ marginBottom: 20 }}>
          <Space align="start" size={16}>
            <PortfolioPortrait key={portraitToken} size={96} portrait={portrait} fallback={fallbackPortrait} preview />
            <Space direction="vertical" size={8}>
              {isSelf ? <>
                <Upload accept="image/jpeg,image/png" showUploadList={false} disabled={portraitBusy} beforeUpload={savePortrait}><Button icon={<PlusOutlined />} loading={portraitBusy} disabled={!consent}>上传头像</Button></Upload>
                <Checkbox checked={consent} onChange={e => setConsent(e.target.checked)}>本人同意在小程序公开展示此头像</Checkbox>
                {portraitAvailable && <Button danger onClick={() => void removePortrait()} loading={portraitBusy}>移除头像</Button>}
                <Typography.Text type="secondary">支持 4MB 以内的 PNG/JPEG，上传后裁切为 512×512 JPEG。</Typography.Text>
              </> : <>
                {portraitAvailable && <Button danger onClick={() => void removePortrait()} loading={portraitBusy}>移除头像</Button>}
                <Typography.Text type="secondary">设计师本人可授权上传真实头像，管理员可移除。</Typography.Text>
              </>}
            </Space>
          </Space>
          <Form.Item name="defaultAvatar" label="默认头像" initialValue={DEFAULT_PORTFOLIO_AVATAR}
            extra="未上传真实头像时，小程序展示所选头像。" style={{ marginTop: 16, marginBottom: 0 }}>
            <Select options={PORTFOLIO_DEFAULT_AVATARS.map(({ value, label }) => ({ value, label }))} />
          </Form.Item>
        </Card>
        <Form.Item name="template" label="小程序展示模板" rules={[{ required: true }]} extra="保存后，小程序重新进入作品集时使用所选模板；作品、筛选与咨询记录共用。未设置的作品集保持现有版。">
          <Select options={PORTFOLIO_TEMPLATES.map(option => ({ value: option.value, label: option.label }))} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(before, after) => before.template !== after.template}>{({ getFieldValue }) => <Typography.Paragraph type="secondary">{PORTFOLIO_TEMPLATES.find(option => option.value === getFieldValue('template'))?.description}</Typography.Paragraph>}</Form.Item>
        <Form.Item name="bio" label="设计师自述"><Input.TextArea maxLength={500} rows={4} showCount /></Form.Item>
        <Form.Item name="styles" label="擅长风格（最多8个）"><Select mode="tags" maxCount={8} options={STYLE_OPTIONS.map(value => ({ value, label: value }))} /></Form.Item>
        <Form.Item name="layoutSpecialties" label="擅长户型（最多6个）"><Select mode="multiple" maxCount={6} options={LAYOUT_OPTIONS.map(value => ({ value, label: value }))} /></Form.Item>
        <Typography.Title level={5}>服务城市与区县</Typography.Title>
        <Form.List name="cities">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%' }}>{fields.map(field => <Card key={field.key} size="small" extra={<Button type="link" danger onClick={() => remove(field.name)}>移除</Button>}>
          <Form.Item name={[field.name, 'code']} label="服务城市" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={CITY_OPTIONS} placeholder="搜索并选择城市" onChange={code => { form.setFieldValue(['cities', field.name, 'name'], cityNameFor(code)); form.setFieldValue(['cities', field.name, 'districts'], []); }} /></Form.Item>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => <Form.Item name={[field.name, 'districts']} label="服务区县（留空表示全市）"><Select mode="multiple" showSearch optionFilterProp="label" options={districtOptions(getFieldValue(['cities', field.name, 'code']) || '')} /></Form.Item>}</Form.Item>
        </Card>)}{fields.length < 10 && <Button onClick={() => add({ code: '', name: '', districts: [] })} icon={<PlusOutlined />}>添加服务城市</Button>}</Space>}</Form.List>
        <Form.Item name="featuredWorkIds" label="精选作品及顺序（最多12个）" extra="按选择顺序展示；下架或许可失效的作品不会公开。" style={{ marginTop: 20 }}><Select mode="multiple" maxCount={12} options={works.filter(w => w.kind === 'designer_work').map(w => ({ value: w.id, label: w.content.title || '未命名作品' }))} /></Form.Item>
      </Form>
      }, { key: 'contact', label: '公开联系方式', children: <ProfileContactEditor key={`${editorSequence}:${portraitToken}`} value={contact} change={changeContact}
        author={author} portrait={portrait} fallbackPortrait={fallbackPortrait} city={cities?.[0]?.name} isSelf={isSelf} disabled={loading || saving || readingQr}
        qrUrl={selected ? `/api/portfolio/profiles/${selected}/contact-qr` : undefined} readImage={readQr} /> }]} />
      </Spin>
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
function TemplateLibrary({ open, onClose, manager, authors }: { open: boolean; onClose: () => void; manager: boolean; authors: Author[] }) {
  const router = useRouter(), mutations = useRef(new PortfolioMutations());
  const [items, setItems] = useState<TemplateRow[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [styleFilter, setStyleFilter] = useState(''), [query, setQuery] = useState('');
  const [detail, setDetail] = useState<TemplateDetail | null>(null), [detailLoading, setDetailLoading] = useState(false), [creating, setCreating] = useState(false), [authorId, setAuthorId] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const params = new URLSearchParams({ limit: '50' }); if (styleFilter) params.set('style', styleFilter); if (query) params.set('query', query); setItems((await portfolioRequest<{ items: TemplateRow[] }>('templates?' + params)).items); }
    catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [styleFilter, query]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try { setDetail(await portfolioRequest<TemplateDetail>('templates/' + id)); } catch (e) { notify.error('读取失败', { description: errorText(e) }); } finally { setDetailLoading(false); }
  };
  const instantiate = async (templateId: string) => {
    if (manager && !authorId) { notify.error('请选择设计师', { description: '管理员需先选择作品归属的设计师。' }); return; }
    setCreating(true);
    try {
      const result = await mutations.current.write<{ id: string }>(`templates/${templateId}/instantiate`, manager ? { authorId } : {});
      notify.success('已从素材创建草稿', { description: '示例图片与文案已带入，请在编辑器中核对并补充许可信息后再提交审核。' });
      setDetail(null); onClose(); router.push('/case-publishing/' + result.id);
    } catch (e) { notify.error('创建失败', { description: errorText(e) }); } finally { setCreating(false); }
  };
  const content = detail?.template.content;
  return <>
    <Modal open={open} onCancel={onClose} footer={null} width={960} title="作品集素材库">
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="素材库包含平台共享模板与企业模板（AI 效果图）。一键创建为草稿作品后，仍需补充真实信息并走企业审核发布。" />
      <Space style={{ marginBottom: 16 }} wrap>
        <Select allowClear placeholder="风格" style={{ width: 120 }} value={styleFilter || undefined} onChange={value => setStyleFilter(value || '')} options={STYLE_OPTIONS.map(value => ({ value, label: value }))} />
        <Input.Search allowClear placeholder="搜索标题/说明" style={{ width: 220 }} enterButton onSearch={value => setQuery(value)} />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>{items.map(t => <Col key={t.id} xs={12} md={8}><Card hoverable size="small" cover={t.cover_asset_id ? <Image preview={false} src={templateAssetUrl(t.id, t.cover_asset_id)} alt={t.title} style={{ height: 150, objectFit: 'cover' }} /> : null} onClick={() => void openDetail(t.id)}>
          <Card.Meta title={t.title} description={<Space direction="vertical" size={2}>
            <Space size={4} wrap><Tag color="green">{t.primary_style}</Tag>{t.scope === 'platform' && <Tag color="blue">平台共享</Tag>}{t.layout_types.map(l => <Tag key={l}>{l}</Tag>)}</Space>
            <Typography.Text type="secondary">{t.city_name}·{t.district} · {t.rooms}{t.area ? ` · ${t.area}㎡` : ''} · {t.asset_count} 张示例图</Typography.Text>
          </Space>} />
        </Card></Col>)}</Row>
        {!loading && !items.length && <Empty description="暂无素材模板，请联系管理员导入。" />}
      </Spin>
    </Modal>
    <Drawer title={detail?.template.title || '素材预览'} width={720} open={!!detail || detailLoading} onClose={() => setDetail(null)} destroyOnHidden
      extra={detail ? <Space>{manager && <Select style={{ width: 150 }} placeholder="归属设计师" value={authorId || undefined} onChange={setAuthorId} options={authors.map(a => ({ value: String(a.id), label: a.display_name || '未填姓名' }))} />}<Button type="primary" loading={creating} onClick={() => void instantiate(detail.template.id)}>使用此模板创建作品</Button></Space> : null}>
      {detail && <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Image.PreviewGroup><Row gutter={[8, 8]}>{detail.images.map(image => <Col key={image.id} span={12}><Image src={templateAssetUrl(detail.template.id, image.id)} alt={image.space} style={{ borderRadius: 8 }} /></Col>)}</Row></Image.PreviewGroup>
        <Typography.Paragraph style={{ marginBottom: 0 }}>{detail.template.description}</Typography.Paragraph>
        <Space size={4} wrap><Tag color="green">{detail.template.primary_style}</Tag>{detail.template.scope === 'platform' && <Tag color="blue">平台共享</Tag>}{detail.template.layout_types.map(l => <Tag key={l}>{l}</Tag>)}<Typography.Text type="secondary">{detail.template.rooms}{detail.template.area ? ` · ${detail.template.area}㎡` : ''}</Typography.Text></Space>
        {!!content?.palette?.length && <Space size={4} wrap>{content.palette.map(p => <Tag key={p.hex} color={p.hex}>{p.name} {p.hex}</Tag>)}</Space>}
        {!!content?.materials?.length && <Typography.Text type="secondary">主材：{content.materials.join('、')}</Typography.Text>}
        {!!content?.highlights?.length && <Typography.Text type="secondary">亮点：{content.highlights.join('；')}</Typography.Text>}
        <Alert type="warning" showIcon message="模板图片为 AI 效果图，aiGenerated 标记随图保留；发布前请在编辑器补充图片许可与小区信息。" />
      </Space>}
    </Drawer>
  </>;
}
export function PublishingWorkbench() {
  const { user, isLoading } = useCurrentUser(), router = useRouter();
  const [items, setItems] = useState<WorkRow[]>([]), [authors, setAuthors] = useState<Author[]>([]), [manager, setManager] = useState(false), [tab, setTab] = useState('works'), [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [selected, setSelected] = useState<WorkRow | null>(null), [creating, setCreating] = useState(false), [createOpen, setCreateOpen] = useState(false), [libraryOpen, setLibraryOpen] = useState(false), [hasMore, setHasMore] = useState(false);
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
  return <PageContainer title="案例发布管理" subTitle={manager ? '企业审核与发布；设计师作品和企业授权参考分别管理。' : '维护本人作品，提交企业审核后发布。'} extra={<Space><Button icon={<AppstoreOutlined />} onClick={() => setLibraryOpen(true)}>从素材库创建</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>新建案例</Button></Space>}>
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
    {tab === 'profiles' && <Profiles authors={authors} currentUserId={user?._id || ''} />}{tab === 'communities' && <CommunityRequests manager={manager} />}
    <TemplateLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} manager={manager} authors={authors} />
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
