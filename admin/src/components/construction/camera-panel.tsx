'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, errorText } from './client';
import { RecordingCapacityPreview } from './recording-capacity-preview';
import { CameraActivity } from './camera-activity';
import { CameraCoverage } from './camera-coverage';
import { CameraCleanup } from './camera-cleanup';
import { CameraCustomerGrantEditor, type CameraCustomerGrant } from './camera-customer-grant';
type Camera = { id: string; binding_id?: string; name: string; version: number; project_id?: string; ptz_enabled: boolean;recording_enabled?:boolean;retention_days?:number;retention_override_days?:number|null;recording_version?:number;recording_state?:string;recording_error?:string;recording_mode?:'cloud'|'sd';sd_last_error?:string;sd_checked_at?:string };
type RetentionDefault={retentionDays:number;version:number;affectedCount:number};
type Storage={level:string;blocked:boolean;totalBytes:string|null;availableBytes:string|null;usedPercent:number|null;sampledAt:string|null};
type ServiceOrder={id:string;status:string;cameraCount:number;boundCount:number};
const capacity=(bytes:string|null)=>bytes===null?'未知':(Number(bytes)/1024**3).toFixed(1)+' GiB';
const orderStates:Record<string,string>={pending_quote:'待报价',quoted:'待确认',confirmed:'已确认',scheduled:'已排期',accepted:'服务中',exited:'已退场'};
export function CameraPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Camera[]>([]), [inventory, setInventory] = useState<Camera[]>([]);
  const [manage, setManage] = useState(false), [configure, setConfigure] = useState(false), [platform, setPlatform] = useState(false), [chosen, setChosen] = useState<string>();
  const [serviceOrder,setServiceOrder]=useState<ServiceOrder|null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storage,setStorage]=useState<Storage|null>(null);
  const [recordingCamera,setRecordingCamera]=useState<Camera>(),[retentionLimit,setRetentionLimit]=useState(7);
  const [recordingForm]=Form.useForm(),[defaultForm]=Form.useForm();
  const [defaults,setDefaults]=useState<RetentionDefault|null>(null),[editingDefault,setEditingDefault]=useState(false);
  const [customerGrant, setCustomerGrant] = useState<CameraCustomerGrant | null>(null);
  const retentionSource=Form.useWatch('retentionSource',recordingForm);
  const previewDays=Form.useWatch('retentionDays',recordingForm),recordingMode=Form.useWatch('recordingMode',recordingForm)||'cloud';
  const [form] = Form.useForm(); const alive = useRef(true),requestSequence=useRef(0);
  const root = 'video/projects/' + projectId;
  const orderLimit=!!serviceOrder&&serviceOrder.boundCount>=serviceOrder.cameraCount;
  const orderEnded=!!serviceOrder&&serviceOrder.status==='exited';
  const orderPending=!!serviceOrder&&!orderEnded&&!['confirmed','scheduled','accepted'].includes(serviceOrder.status);
  const orderBlocked=orderLimit||orderPending||orderEnded;
  const load = useCallback(async () => {
    const sequence=++requestSequence.current;
    setLoading(true);
    try {
      const state = await constructionRequest<{ items: Camera[]; canManage: boolean; canConfigure: boolean;maxRetentionDays:number;storage:Storage|null;serviceOrder:ServiceOrder|null;retentionDefault:RetentionDefault|null;customerGrant:CameraCustomerGrant|null }>(root + '/cameras');
      const available = state.canManage ? await constructionRequest<{ items: Camera[]; canRegister: boolean }>(root + '/inventory') : { items: [], canRegister: false };
      if (!alive.current||sequence!==requestSequence.current) return;
      setItems(state.items); setManage(state.canManage); setConfigure(state.canConfigure); setInventory(available.items); setPlatform(available.canRegister); setError('');
      setRetentionLimit(state.maxRetentionDays); setServiceOrder(state.serviceOrder||null);
      setStorage(state.storage); setDefaults(state.retentionDefault); setCustomerGrant(state.customerGrant);
    } catch (e) { if (alive.current&&sequence===requestSequence.current) { setError(errorText(e)); setItems([]); setInventory([]);setStorage(null);setServiceOrder(null);setCustomerGrant(null); } }
    finally { if (alive.current&&sequence===requestSequence.current) setLoading(false); }
  }, [root]);
  useEffect(() => { alive.current = true;setRecordingCamera(undefined); void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(()=>{if(!items.length)return;const timer=setTimeout(()=>void load(),5000);return()=>clearTimeout(timer);},[items,load]);
  useEffect(()=>{if(recordingCamera&&retentionSource==='enterprise'&&defaults)recordingForm.setFieldsValue({retentionDays:defaults.retentionDays});},[recordingCamera,retentionSource,defaults,recordingForm]);
  const write = async (path: string, data: unknown, success: string) => {
    setBusy(true);
    try {
      await constructionRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!alive.current) return; notify.success(success); setRegistering(false);setRecordingCamera(undefined);setEditingDefault(false); setChosen(undefined); await load();
    } catch (e) { if (alive.current) { notify.error('摄像头操作未完成', { description: errorText(e) }); await load(); } }
    finally { if (alive.current) setBusy(false); }
  };
  const preview = async () => {
    const target = window.open('about:blank', '_blank'); if (!target) { notify.error('浏览器阻止了播放窗口，请允许弹出窗口后重试'); return; }
    target.opener = null; setBusy(true);
    try {
      const result = await constructionRequest<{ url: string }>(root + '/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!alive.current) { target.close(); return; } target.location.href = result.url;
    } catch (e) { target.close(); notify.error('暂时无法打开直播', { description: errorText(e) }); }
    finally { if (alive.current) setBusy(false); }
  };
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert type="info" showIcon message="私有工地视频" description="当前工地的有效成员可查看直播。负责人和项目经理可抓拍及操作已验证支持云台的设备。业主需单独授权，直播、回放与公开直播分别管理。" />
    {serviceOrder&&<Alert type={orderBlocked?'warning':'info'} showIcon message={'托管订单 · '+(orderStates[serviceOrder.status]||serviceOrder.status)+' · 摄像头 '+serviceOrder.boundCount+'/'+serviceOrder.cameraCount+' 路'+(orderLimit?'（已满）':'')} description={orderEnded?'托管服务已退场，请先在“托管服务”Tab建立并确认新的托管订单后再绑定摄像头。':orderPending?'托管订单确认后才能绑定摄像头，请先在“托管服务”Tab完成报价确认；安装与验收也在该Tab登记，费用线下结算。':orderLimit?'订单路数已全部绑定，解绑后才能绑定其他摄像头；安装与验收在“托管服务”Tab登记。':'绑定数量以订单路数为上限；安装与验收在“托管服务”Tab登记，费用线下结算。'} />}
    {configure&&storage&&<Alert showIcon type={storage.blocked?'error':storage.level==='ok'?'success':'warning'} message={'云录像存储 · '+(({ok:'正常',warning:'容量预警',critical:'容量紧张',blocked:'空间不足，录制保护中',unavailable:'状态暂不可用'} as Record<string,string>)[storage.level]||'状态暂不可用')} description={storage.level==='unavailable'?'无法核对存储空间，持续录像状态待核对；直播与已有录像仍可查看。':<>已用 {storage.usedPercent?.toFixed(1)}%，剩余 {capacity(storage.availableBytes)} / 总计 {capacity(storage.totalBytes)}。{storage.blocked?'按保护策略暂停录制，恢复安全空间后自动核对原设置；不提前删除有效录像。':storage.level==='ok'?'持续监测容量，空间不足时自动暂停录制。':'请及时扩容或清理已过期媒体；有效期内录像不会自动提前删除。'}</>} />}
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重新读取</Button>} />}
    <Space wrap><Button type="primary" disabled={busy || !items.length} onClick={() => void preview()}>打开工地视频</Button><Button disabled={busy} onClick={() => void load()}>刷新</Button>{configure&&defaults&&<Button disabled={busy} onClick={()=>{defaultForm.setFieldsValue({retentionDays:defaults.retentionDays,expectedVersion:defaults.version});setEditingDefault(true);}}>企业默认留存</Button>}{platform && <Button disabled={busy} onClick={() => { form.resetFields(); setRegistering(true); }}>分配 WVP 摄像头</Button>}</Space>
    {manage && <Space wrap><Select aria-label="待绑定摄像头" placeholder={orderEnded?'托管服务已退场，需新的已确认订单':orderPending?'托管订单确认后才能绑定摄像头':orderLimit?'订单摄像头路数已全部绑定':'选择本企业尚未绑定的摄像头'} value={chosen} style={{ minWidth: 260 }} disabled={busy||orderBlocked} onChange={setChosen} options={inventory.filter(c => !c.project_id).map(c => ({ value: c.id, label: c.name }))} /><Button disabled={busy || !chosen || orderBlocked} onClick={() => { const c = inventory.find(c => c.id === chosen); if (c) void write(root + '/binding', { cameraId: c.id, expectedVersion: c.version, bind: true }, '摄像头已绑定'); }}>绑定到当前工地</Button></Space>}
    {configure && customerGrant && <CameraCustomerGrantEditor key={projectId + '/' + customerGrant.userId} projectId={projectId} grant={customerGrant} refresh={load} />}
    <Table<Camera> rowKey="id" pagination={false} loading={loading} dataSource={items} locale={{ emptyText: <Empty description="当前工地尚未绑定摄像头" /> }} columns={[
      { title: '摄像头', dataIndex: 'name',width:160 }, { title: '云台',width:140, render: (_, c) => <Space><Tag>{c.ptz_enabled ? '已开放' : '未开放'}</Tag>{configure && <Popconfirm title={c.ptz_enabled ? '关闭云台控制？' : '为已验证支持方向控制的设备开放云台？'} onConfirm={() => write(root+'/configure',{cameraId:c.id,expectedVersion:c.version,ptzEnabled:!c.ptz_enabled},'云台控制设置已保存')}><Button size="small" disabled={busy}>{c.ptz_enabled ? '关闭' : '开放'}</Button></Popconfirm>}</Space> },
      {title:'录像',render:(_,c)=><Space direction="vertical" size="small"><Tag color={c.recording_state==='recording'?'green':c.recording_state==='error'?'error':undefined}>{c.recording_mode==='sd'&&c.recording_state==='stopped'?'SD回放模式':({recording:'正在录制',pending:'正在应用设置',stopped:'已停止',error:'录制异常'} as Record<string,string>)[c.recording_state||'']||'未开启'}</Tag><span>{c.recording_mode==='sd'?'4G · 设备本地SD':'有线 · 云端保留 '+(c.retention_days||3)+' 天'+(c.retention_override_days==null?' · 继承企业':' · 单独设置')}</span>{c.recording_mode==='sd'&&<span>{c.sd_last_error?errorText({code:c.sd_last_error}):c.sd_checked_at?'设备时间与SD状态已核对':'正在核对设备时间与SD状态'}</span>}{c.recording_error&&<span>{errorText({code:c.recording_error})}</span>}{configure&&<CameraActivity key={projectId+'/'+c.binding_id} projectId={projectId} bindingId={c.binding_id!} name={c.name} />}{configure&&<CameraCoverage key={'coverage/'+projectId+'/'+c.binding_id} projectId={projectId} bindingId={c.binding_id!} name={c.name} />}{configure&&<CameraCleanup key={'cleanup/'+projectId+'/'+c.binding_id} projectId={projectId} bindingId={c.binding_id!} name={c.name} />}{configure&&<Button size="small" disabled={busy} onClick={()=>{recordingForm.setFieldsValue({enabled:!!c.recording_enabled,retentionDays:c.retention_days||3,recordingMode:c.recording_mode||'cloud',retentionSource:c.retention_override_days==null?'enterprise':'camera'});setRecordingCamera(c);}}>录制设置</Button>}</Space>},
      ...(manage ? [{ title: '操作',width:100, render: (_: unknown, c: Camera) => <Popconfirm title="解绑此摄像头？" description="请先停止录制。当前直播会话将失效，已有抓拍及有效期内录像仍保留在本工地。" onConfirm={() => write(root + '/binding', { cameraId: c.id, expectedVersion: c.version, bind: false }, '摄像头已解绑')}><Button danger disabled={busy}>解绑</Button></Popconfirm> }] : []),
    ]} />
    <Modal title="分配 WVP 摄像头到当前企业" open={registering} confirmLoading={busy} onCancel={() => !busy && setRegistering(false)} onOk={() => void form.validateFields().then(values => write('video/register', values, '摄像头已分配到当前企业')).catch(() => {})}>
      <Form form={form} layout="vertical"><Form.Item name="name" label="名称" rules={[{ required: true, max: 80 }]}><Input maxLength={80} /></Form.Item><Form.Item name="deviceId" label="WVP 设备编号" rules={[{ required: true, pattern: /^\d{20}$/ }]}><Input maxLength={20} /></Form.Item><Form.Item name="channelId" label="视频通道编号" rules={[{ required: true, pattern: /^\d{20}$/ }]}><Input maxLength={20} /></Form.Item></Form>
    </Modal>
    <Modal title={'录像设置 · '+(recordingCamera?.name||'')} open={!!recordingCamera} forceRender confirmLoading={busy} styles={{body:{maxHeight:'calc(100dvh - 260px)',overflowY:'auto'}}} onCancel={()=>!busy&&setRecordingCamera(undefined)} onOk={()=>void recordingForm.validateFields().then(values=>recordingCamera&&write(root+'/recording',{bindingId:recordingCamera.binding_id,expectedVersion:recordingCamera.recording_version||0,...values,enabled:values.recordingMode==='sd'?false:!!values.enabled},'录像策略已保存，正在核对实际录制状态')).catch(()=>{})}>
      <Alert type="info" showIcon message={recordingMode==='sd'?'按需读取设备SD录像':'连续上传到服务器'} description={recordingMode==='sd'?'SD卡须已启用本地连续录像；本设置不会修改设备录制。仅观看时上传，退出后停止本次回放。可读范围从当前绑定的时间核对后开始，保留取决于卡容量与覆盖；断网时远程不可读。原云录像仍按原天数保留。':'适用于有线宽带工地。启用后无人观看也持续上传视频。切换到SD模式会先停止本模块所属云端录制。'} />
      <Form name="camera-recording" form={recordingForm} layout="vertical" style={{marginTop:16}}><Form.Item name="recordingMode" label="录像模式" rules={[{required:true}]}><Select options={[{value:'cloud',label:'有线 · 云端录像'},{value:'sd',label:'4G · 本地SD录像'}]} /></Form.Item><Form.Item hidden={recordingMode==='sd'} name="enabled" label="连续云端录像" valuePropName="checked"><Switch /></Form.Item><Form.Item hidden={recordingMode==='sd'} name="retentionSource" label="留存设置"><Select options={[{value:'enterprise',label:'继承企业默认（'+(defaults?.retentionDays||3)+' 天）'},{value:'camera',label:'此摄像头单独设置'}]} /></Form.Item><Form.Item hidden={recordingMode==='sd'} name="retentionDays" label="保留天数" rules={[{required:true,type:'number',min:1,max:retentionLimit}]} extra={'企业默认 '+(defaults?.retentionDays||3)+' 天；当前节点最多 '+retentionLimit+' 天。缩短保留时间后，过期录像将不可播放并进入清理；延长不能恢复已进入清理或删除的录像。'}><InputNumber disabled={retentionSource==='enterprise'} min={1} max={retentionLimit} precision={0} /></Form.Item></Form>
      <RecordingCapacityPreview key={projectId+'/'+recordingCamera?.binding_id} projectId={projectId} bindingId={recordingCamera?.binding_id} days={retentionSource==='enterprise'?defaults?.retentionDays||3:Number(previewDays)} open={!!recordingCamera&&recordingMode==='cloud'} />
    </Modal>
    <Modal title="企业默认录像留存" open={editingDefault} forceRender confirmLoading={busy} onCancel={()=>!busy&&setEditingDefault(false)} onOk={()=>void defaultForm.validateFields().then(values=>write(root+'/retention-default',values,'企业默认留存已保存')).catch(()=>{})}>
      <Alert type="info" showIcon message={'当前 '+(defaults?.affectedCount||0)+' 路云端策略继承企业默认'} description="保存后应用于本企业仍在绑定且选择继承的云端策略，之后新设置也可继承。不会开启已关闭的录像；单独设置、SD模式和历史绑定保留原设置。缩短后过期录像不可播放并进入清理；延长不能恢复已进入清理或删除的文件。" />
      <Form name="camera-retention-default" form={defaultForm} layout="vertical" style={{marginTop:16}}><Form.Item name="expectedVersion" hidden><InputNumber /></Form.Item><Form.Item name="retentionDays" label="默认保留天数" rules={[{required:true,type:'number',min:1,max:retentionLimit}]} extra={'当前节点最多 '+retentionLimit+' 天。'}><InputNumber min={1} max={retentionLimit} precision={0} /></Form.Item></Form>
    </Modal>
  </Space>;
}
