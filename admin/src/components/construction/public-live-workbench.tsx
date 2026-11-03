'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Spin, Steps, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { constructionRequest, ConstructionRequestError, errorText } from './client';
import { PublicLiveVideo } from './public-live-video';
type Material={id:string;key:string;versionId:string;revision:number;status:string;statusLabel:string;available:boolean;bindingId:string;alias:string;name:string;audience:string;scope:string;reason:string};
type View={canPrepare:boolean;canReview:boolean;revision:number;cameras:Array<{bindingId:string;name:string}>;material:Material|null;proxy:{state:string;errorCode:string}|null};
type Pending={path:string;key:string;body:unknown;label:string};
const labels:Record<string,string>={save:'保存直播草稿',submit:'发送业主直播预览',publish:'审核公开直播',reject:'退回直播申请',withdraw:'停止公开直播'};
export function PublicLiveWorkbench({projectId}:{projectId:string}){
  const base='public-live/'+projectId,storage='public-live-operation:'+projectId,alive=useRef(false),flight=useRef(false),epoch=useRef(0);
  const [view,setView]=useState<View|null>(null),[draft,setDraft]=useState({bindingId:'',alias:'',name:''}),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Pending|null>(null),[url,setUrl]=useState('');
  const clearPreview=useCallback(()=>setUrl(''),[]);
  const load=useCallback(async(replace=false)=>{
    const g=++epoch.current;setLoading(true);setError('');
    try{const next=await constructionRequest<View>(base);if(!alive.current||g!==epoch.current)return;setView(next);
      if(replace){setDraft({bindingId:next.material?.bindingId||'',alias:next.material?.alias||'',name:next.material?.name||''});setDirty(false);setChecked(false);}
      if(!next.material?.available||!['draft','pending_owner','owner_approved','published'].includes(next.material.status))setUrl('');
    }catch(e){if(alive.current&&g===epoch.current){setError(errorText(e));setUrl('');if(e instanceof ConstructionRequestError&&[401,403,404].includes(e.statusCode||0)){setView(null);setDraft({bindingId:'',alias:'',name:''});}}}
    finally{if(alive.current&&g===epoch.current)setLoading(false);}
  },[base]);
  useEffect(()=>{alive.current=true;try{const p=sessionStorage.getItem(storage);if(p)setPending(JSON.parse(p));}catch{}void load(true);const timer=setInterval(()=>{if(!flight.current)void load();},10000);return()=>{alive.current=false;epoch.current++;clearInterval(timer);};},[load,storage]);
  const edit=(patch:Partial<typeof draft>)=>{setDraft(d=>({...d,...patch}));setDirty(true);setChecked(false);setUrl('');};
  const write=async(action:string,reason='')=>{
    if(flight.current)return;const m=view?.material;
    const op=pending||{key:'public-live.'+crypto.randomUUID(),path:action==='save'?base:base+'/'+action,label:labels[action],
      body:action==='save'?{expectedRevision:view?.revision||0,...draft}:{expectedRevision:m?.revision,versionId:m?.versionId,...(reason?{reason}:{})}};
    setPending(op);try{sessionStorage.setItem(storage,JSON.stringify(op));}catch{}
    flight.current=true;setBusy(true);setError('');setUrl('');
    try{const receipt=await constructionRequest<{stopped?:boolean}>(op.path,{method:'POST',headers:{'Idempotency-Key':op.key},body:JSON.stringify(op.body)});
      if(!alive.current)return;sessionStorage.removeItem(storage);setPending(null);
      if(receipt.stopped===false){setError('公开权限已撤回，媒体清理尚未确认。请核对清理结果后再变更机位。');notify.error('停止回执待核对');}
      else notify.success(op.label+'成功');await load(true);
    }catch(e){if(!alive.current)return;if(e instanceof ConstructionRequestError&&!e.uncertain){sessionStorage.removeItem(storage);setPending(null);}setError(errorText(e));notify.error('直播操作未完成',{description:errorText(e)});}
    finally{flight.current=false;if(alive.current)setBusy(false);}
  };
  const preview=async()=>{
    const m=view?.material;if(!m||dirty||busy)return;setBusy(true);setError('');
    try{const r=await constructionRequest<{url:string}>(base+'/session',{method:'POST',body:JSON.stringify({id:m.id,versionId:m.versionId})});if(alive.current)setUrl(r.url);}
    catch(e){if(alive.current){setUrl('');setError(errorText(e));notify.error('预览暂时无法连接');}}
    finally{if(alive.current)setBusy(false);}
  };
  const withReason=(action:'reject'|'withdraw')=>{let reason='';Modal.confirm({title:labels[action],content:<><Typography.Paragraph>{action==='withdraw'?'仅停止这路直播，照片和服务记录的授权不变。':'退回后，修改范围需重新送业主预览。'}</Typography.Paragraph><Input.TextArea maxLength={500} placeholder="填写原因" onChange={e=>{reason=e.target.value;}}/></>,onOk:()=>write(action,reason.trim())});};
  const m=view?.material,disabled=busy||!!pending||!view?.canPrepare,active=!!m&&['pending_owner','owner_approved','published'].includes(m.status);
  const failure=useCallback(()=>{setUrl('');setError('直播暂时无法连接，请重试预览。');},[]);
  return <Card title="直播公开" extra={<Tag>{m?.statusLabel||'尚未申请'}</Tag>}><Spin spinning={loading}><Space direction="vertical" size={16} style={{width:'100%'}}>
    <Steps size="small" current={!m||['draft','declined','rejected','withdrawn'].includes(m.status)?0:m.status==='pending_owner'?1:m.status==='owner_approved'?2:3} items={['准备机位','业主决定','企业审核','公开直播'].map(title=>({title}))}/>
    {error&&<Alert type="error" showIcon message={error} action={<Button onClick={()=>load()}>读取最新状态</Button>}/>}
    {pending&&<Alert type="warning" showIcon message={pending.label+'结果尚未确认'} action={<Button disabled={busy} onClick={()=>write('save')}>核对同次操作</Button>}/>}
    <Row gutter={[16,16]}><Col xs={24} lg={12}><Form layout="vertical"><Form.Item label="当前项目机位"><Select value={draft.bindingId||undefined} disabled={disabled||active} options={view?.cameras.map(c=>({value:c.bindingId,label:c.name}))} placeholder="选择合法机位" onChange={bindingId=>edit({bindingId})}/></Form.Item>
      <Form.Item label="公开名称"><Input maxLength={80} value={draft.name} placeholder="不含姓名、电话或门牌" disabled={disabled||active} onChange={e=>edit({name:e.target.value})}/></Form.Item>
      <Form.Item label="公开机位别名"><Input maxLength={40} value={draft.alias} placeholder="例如：客厅机位" disabled={disabled||active} onChange={e=>edit({alias:e.target.value})}/></Form.Item></Form>
      <Alert type="info" showIcon message="仅此机位的无声实时画面" description="访客包括分享链接进入者；不提供回放、抓拍、下载和云台控制。直播与照片、服务节选分别授权，不自动进行人物或画面脱敏。"/>
    </Col><Col xs={24} lg={12}><Typography.Title level={5}>访客预览 · {draft.alias||'待选择机位'}</Typography.Title>
      {url?<PublicLiveVideo url={url} onFailure={failure}/>:<div style={{aspectRatio:'16 / 9',background:'#f5f5f5',display:'grid',placeItems:'center'}}><Button disabled={disabled||dirty||!m||!m.available||['withdrawn','declined','rejected'].includes(m.status)} onClick={preview}>连接无声预览</Button></div>}
      <Typography.Paragraph type="secondary">仅供授权预览，尚未公开。机位、取景或业主变化时，先停止直播，再重新申请。</Typography.Paragraph>{m?.reason&&<Alert message={m.reason} type="warning"/>}
    </Col></Row>
    <Checkbox checked={checked} disabled={disabled||dirty} onChange={e=>setChecked(e.target.checked)}>已核对完整画面、公开别名与观看范围</Checkbox>
    <Space wrap><Button disabled={busy} onClick={()=>load(!dirty)}>读取最新状态</Button><Button disabled={disabled||active||!dirty||!draft.bindingId||!draft.alias||!draft.name} onClick={()=>write('save')}>保存直播草稿</Button>
      {m?.status==='draft'&&<Button type="primary" disabled={disabled||dirty||!checked} onClick={()=>write('submit')}>发送业主直播预览</Button>}
      {m?.status==='owner_approved'&&view?.canReview&&<><Button disabled={disabled} onClick={()=>withReason('reject')}>退回修改</Button><Button type="primary" disabled={disabled||!checked} onClick={()=>write('publish')}>审核并公开直播</Button></>}
      {m&&m.status!=='withdrawn'&&<Button danger disabled={disabled} onClick={()=>withReason('withdraw')}>停止公开直播</Button>}
      {m?.status==='withdrawn'&&view?.proxy&&!['stopped','failed'].includes(view.proxy.state)&&<Button disabled={busy} onClick={async()=>{try{await constructionRequest(base+'/reconcile',{method:'POST',body:'{}'});notify.success('已核对媒体清理');await load();}catch(e){notify.error('清理尚未确认',{description:errorText(e)});}}}>核对媒体清理结果</Button>}
      {url&&<Button onClick={clearPreview}>关闭预览</Button>}
    </Space>
  </Space></Spin></Card>;
}
