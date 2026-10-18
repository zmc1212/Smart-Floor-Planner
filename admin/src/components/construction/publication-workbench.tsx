'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Empty, Input, Modal, Row, Select, Space, Spin, Steps, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { CITY_OPTIONS, districtOptions } from '@/lib/portfolio/regions';
import type { PublicMaterialInput, PublicSourceInput, PublicPhotoInput } from '@/lib/construction/public-contract';
import { constructionRequest, ConstructionRequestError, errorText } from './client';

type Source = PublicSourceInput & { role: string; date: string; media: Array<{id:string;width:number;height:number}> };
type Material = { id:string;versionId:string;revision:number;status:string;statusLabel:string;name:string;cityCode:string;district:string;stageName:string;reason:string;
  sources:PublicSourceInput[];draftPhotos:PublicPhotoInput[];photos:Array<{id:string}>;excerpts:Array<{role:string;text:string;date:string}> };
type View = { owner:boolean;manage:boolean;write:boolean;revision:number;unavailable:boolean;projectName:string;material:Material|null;sourceItems:Source[];audits:Array<{action:string;reason:string;created_at:string}> };
type Draft = Omit<PublicMaterialInput,'cityName'>;
type Pending = { key:string;path:string;body:unknown;label:string };
const blank = (): Draft => ({name:'',cityCode:'',district:'',sources:[],photos:[]});
const sourceKey = (s:PublicSourceInput) => s.kind+':'+s.id;
const actionNames:Record<string,string> = {save:'保存草稿',submit:'发送业主预览',publish:'审核并公开',reject:'退回修改',withdraw:'撤回公开'};
const auditNames:Record<string,string> = {...actionNames,'owner.preview':'业主查看全部预览','owner.approve':'业主同意这一版','owner.decline':'业主暂不公开','owner.withdraw':'业主撤回授权'};

export function PublicationWorkbench({projectId,identity}:{projectId:string;identity:string}) {
  const [view,setView] = useState<View|null>(null), [draft,setDraft] = useState<Draft>(blank), [revision,setRevision] = useState(0);
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [dirty,setDirty] = useState(false), [error,setError] = useState('');
  const [pending,setPending] = useState<Pending|null>(null), [masking,setMasking] = useState<PublicPhotoInput|null>(null);
  const [anchor,setAnchor] = useState<{x:number;y:number}|null>(null), [checked,setChecked] = useState(false);
  const alive=useRef(true), generation=useRef(0), flight=useRef(false);
  const storageKey='construction:public:pending:'+identity+':'+projectId, base='projects/'+projectId+'/public-materials';
  const load=useCallback(async(replace=false)=>{
    const g=++generation.current; setLoading(true); setError('');
    try { const next=await constructionRequest<View>(base); if(!alive.current||g!==generation.current)return;
      setView(next);
      if(replace){setDraft(next.material?{name:next.material.name,cityCode:next.material.cityCode,district:next.material.district,sources:next.material.sources,photos:next.material.draftPhotos.map(p=>({recordId:p.recordId,mediaId:p.mediaId,masks:p.masks}))}:blank());setRevision(next.revision);setDirty(false);setChecked(false);}
    } catch(e){if(alive.current&&g===generation.current){setError(errorText(e));setView(null);
      if(e instanceof ConstructionRequestError&&[401,403,404].includes(e.statusCode||0)){setDraft(blank());setRevision(0);setDirty(false);setChecked(false);setMasking(null);setAnchor(null);setPending(null);sessionStorage.removeItem(storageKey);}
    }}
    finally{if(alive.current&&g===generation.current)setLoading(false);}
  },[base,storageKey]);
  useEffect(()=>{alive.current=true;try{const saved=sessionStorage.getItem(storageKey);if(saved)setPending(JSON.parse(saved));}catch{/* No persistent retry when storage is unavailable. */}
    void load(true);return()=>{alive.current=false;};},[load,storageKey]);
  const edit=(patch:Partial<Draft>)=>{setDraft(d=>({...d,...patch}));setDirty(true);setChecked(false);};
  const reload=()=>dirty?Modal.confirm({title:'读取最新材料？',content:'将用最新版本替换当前尚未保存的编辑。',onOk:()=>load(true)}):load(true);
  const write=async(action:string,reason='')=>{
    if(flight.current)return;
    let operation=pending;
    if(!operation){
      operation={key:'public.'+crypto.randomUUID(),path:action==='save'?base:base+'/'+action,
        body:action==='save'?{expectedRevision:revision,material:draft}:{expectedRevision:revision,versionId:view?.material?.versionId,...(reason?{reason}:{})},label:actionNames[action]};
      setPending(operation);try{sessionStorage.setItem(storageKey,JSON.stringify(operation));}catch{/* Retain the original body in memory. */}
    }
    flight.current=true;setBusy(true);setError('');
    try{await constructionRequest(operation.path,{method:'POST',headers:{'Idempotency-Key':operation.key},body:JSON.stringify(operation.body)});
      if(!alive.current)return;sessionStorage.removeItem(storageKey);setPending(null);notify.success(operation.label+'成功');await load(true);
    }catch(e){if(!alive.current)return;
      if(e instanceof ConstructionRequestError&&!e.uncertain){sessionStorage.removeItem(storageKey);setPending(null);}
      setError(errorText(e));notify.error('操作未完成',{description:errorText(e)});
    }finally{flight.current=false;if(alive.current)setBusy(false);}
  };
  const reasonAction=(action:'reject'|'withdraw')=>{let reason='';Modal.confirm({title:actionNames[action],content:<Input.TextArea maxLength={500} placeholder="填写原因" onChange={e=>{reason=e.target.value;}}/>,onOk:async()=>{if(!reason.trim()){notify.error('请填写原因');throw new Error('reason required');}await write(action,reason.trim());}});};
  const material=view?.material, disabled=busy||!!pending||!view?.write;
  const photoUrl=(p:PublicPhotoInput)=>'/api/construction/'+base+'/source-media/'+p.recordId+'/'+p.mediaId;
  const preparedUrl=(index:number)=>material?'/api/construction/'+base+'/media/'+material.photos[index]?.id+'?versionId='+material.versionId:'';
  const toggle=(s:Source,on:boolean)=>{const selected=on?[...draft.sources,{kind:s.kind,id:s.id,sourceHash:s.sourceHash,text:s.text}]:draft.sources.filter(a=>sourceKey(a)!==sourceKey(s));
    edit({sources:selected,photos:draft.photos.filter(p=>selected.some(a=>a.kind==='site_record'&&a.id===p.recordId))});};
  const addMask=(e:React.MouseEvent<HTMLDivElement>)=>{
    if(!masking)return;const box=e.currentTarget.getBoundingClientRect();const point={x:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))};
    if(!anchor){setAnchor(point);return;}
    const rect={x:Math.min(anchor.x,point.x),y:Math.min(anchor.y,point.y),width:Math.abs(point.x-anchor.x),height:Math.abs(point.y-anchor.y)};
    if(rect.width>0.003&&rect.height>0.003&&masking.masks.length<12)setMasking({...masking,masks:[...masking.masks,rect]});setAnchor(null);
  };
  const maskedPhoto=(p:PublicPhotoInput,url:string)=><div style={{position:'relative',lineHeight:0}}><img src={url} alt="待公开现场照片" style={{width:'100%',display:'block',borderRadius:8}}/>{p.masks.map((m,i)=><div key={i} style={{position:'absolute',left:m.x*100+'%',top:m.y*100+'%',width:m.width*100+'%',height:m.height*100+'%',background:'#17202b',pointerEvents:'none'}}/>)}</div>;
  return <Spin spinning={loading}><div style={{width:'100%',display:'grid',gap:16}}>
    <Steps size="small" current={!material||['draft','rejected','declined','withdrawn'].includes(material.status)?0:material.status==='pending_owner'?1:material.status==='owner_approved'?2:3} items={['准备材料','业主授权','企业审核','公开'].map(title=>({title}))}/>
    {error&&<Alert type="error" showIcon message={error} description="编辑内容已保留。版本冲突时请读取最新材料，重新核对后再保存。"/>}
    {pending&&<Alert type="warning" showIcon message={pending.label+'结果待确认'} action={<Button disabled={busy} onClick={()=>write('save')}>核对同次操作结果</Button>}/>}
    {view?.unavailable&&<Alert type="warning" showIcon message="当前材料或来源已失效，或你没有查看该私聊节选的权限。"/>}
    <Row gutter={[16,16]}><Col xs={24} lg={13}><Card title="选择公开节选" size="small">
      <Typography.Paragraph type="secondary">只选择已向当前业主开放的记录；私聊仅限你正在接待的会话。节选可截取原文，或用 [已隐藏] 遮住私人信息。</Typography.Paragraph>
      {!view?.sourceItems.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用来源，请先在项目会话核对并向业主发布现场记录。"/>}
      {view?.sourceItems.map(s=>{const selected=draft.sources.find(a=>sourceKey(a)===sourceKey(s));return <Card key={sourceKey(s)} size="small" style={{marginBottom:12}}>
        <Checkbox checked={!!selected} disabled={disabled||!selected&&draft.sources.length>=8} onChange={e=>toggle(s,e.target.checked)}>{s.role} · {new Date(s.date).toLocaleString('zh-CN')}</Checkbox>
        <Typography.Paragraph style={{whiteSpace:'pre-wrap',margin:'12px 0'}}>{s.text}</Typography.Paragraph>
        {selected&&<><Typography.Text>公开服务节选</Typography.Text><Input.TextArea disabled={disabled} rows={3} maxLength={1800} value={selected.text} onChange={e=>edit({sources:draft.sources.map(a=>sourceKey(a)===sourceKey(s)?{...a,text:e.target.value}:a)})}/>
          <Space wrap style={{marginTop:12}}>{s.media.map(m=>{const photo=draft.photos.find(p=>p.mediaId===m.id);return <div key={m.id} style={{width:150}}><Checkbox disabled={disabled||!photo&&draft.photos.length>=4} checked={!!photo} onChange={e=>edit({photos:e.target.checked?[...draft.photos,{recordId:s.id,mediaId:m.id,masks:[]}]:draft.photos.filter(p=>p.mediaId!==m.id)})}>公开这张照片</Checkbox>{photo&&<><div style={{marginTop:8}}>{maskedPhoto(photo,photoUrl(photo))}</div><Button size="small" disabled={disabled} onClick={()=>{setMasking(structuredClone(photo));setAnchor(null);}}>检查 / 遮挡照片</Button></>}</div>;})}</Space></>}
      </Card>;})}
      {draft.sources.filter(s=>!view?.sourceItems.some(a=>sourceKey(a)===sourceKey(s))).map(s=><Card size="small" key={sourceKey(s)} style={{marginBottom:12}}><Typography.Text type="secondary">已保存节选 · 原始来源当前不向你开放</Typography.Text><Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{s.text}</Typography.Paragraph><Button disabled={disabled} onClick={()=>edit({sources:draft.sources.filter(a=>sourceKey(a)!==sourceKey(s)),photos:draft.photos.filter(p=>p.recordId!==s.id)})}>移除此节选</Button></Card>)}
      <Typography.Text>公开片区</Typography.Text><Space wrap style={{display:'flex',margin:'8px 0 16px'}}><Select style={{width:200}} showSearch optionFilterProp="label" placeholder="城市" options={CITY_OPTIONS} value={draft.cityCode||undefined} disabled={disabled} onChange={cityCode=>edit({cityCode,district:''})}/><Select style={{width:180}} placeholder="区县" options={districtOptions(draft.cityCode)} value={draft.district||undefined} disabled={disabled} onChange={district=>edit({district})}/></Space>
      <Typography.Text>公开名称</Typography.Text><Input maxLength={80} value={draft.name} disabled={disabled} placeholder="不含姓名、电话、门牌" onChange={e=>edit({name:e.target.value})} style={{margin:'8px 0 16px'}}/>
      <Alert type="warning" showIcon message="请逐张检查人物、门牌和联系方式，完成遮挡；文字中也需隐藏私人信息。"/>
      <Checkbox style={{marginTop:16}} checked={checked} disabled={busy||!!pending} onChange={e=>setChecked(e.target.checked)}>已核对全部节选与照片的公开范围和脱敏结果</Checkbox>
    </Card></Col><Col xs={24} lg={11}><Space direction="vertical" size={16} style={{width:'100%'}}><Card title="访客会看到" size="small" extra={<Tag color="green">预览</Tag>}>
      <Typography.Title level={5} style={{marginTop:0}}>{draft.name||'待填写公开名称'}{material?.stageName?' · '+material.stageName:''}</Typography.Title><Typography.Paragraph type="secondary">{draft.district||'待选择公开片区'}</Typography.Paragraph>
      {draft.sources.map(s=><Typography.Paragraph key={sourceKey(s)} style={{whiteSpace:'pre-wrap'}}>{view?.sourceItems.find(a=>sourceKey(a)===sourceKey(s))?.role||material?.excerpts[draft.sources.indexOf(s)]?.role}：{s.text}</Typography.Paragraph>)}
      <Row gutter={[8,8]}>{draft.photos.map((p,i)=><Col span={12} key={p.mediaId}>{dirty?maskedPhoto(p,photoUrl(p)):<img src={preparedUrl(i)} alt="独立脱敏后的公开照片" style={{width:'100%',borderRadius:8}}/>}</Col>)}</Row>
      <Typography.Paragraph type="secondary" style={{marginTop:12}}>现场照片 {draft.photos.length} 张 · 服务节选 {draft.sources.length} 条</Typography.Paragraph><Alert type="warning" showIcon message="不包含业主姓名、电话、门牌或完整私聊"/>
    </Card><Card title="授权与审核状态" size="small"><Tag color={material?.status==='published'?'green':'default'}>{material?.statusLabel||'尚未保存草稿'}</Tag><Typography.Paragraph style={{marginTop:12}}>业主明确同意这一版后，仍需企业审核才能公开。保存新版本会撤销旧版公开与授权。</Typography.Paragraph>{material?.reason&&<Typography.Paragraph>原因：{material.reason}</Typography.Paragraph>}
      <Space direction="vertical">{view?.audits.slice(0,5).map((a,i)=><Typography.Text type="secondary" key={i}>{auditNames[a.action]||'材料状态更新'} · {new Date(a.created_at).toLocaleString('zh-CN')}{a.reason?' · '+a.reason:''}</Typography.Text>)}</Space>
    </Card></Space></Col></Row>
    <Space wrap style={{position:'sticky',bottom:-24,zIndex:2,background:'#fff',borderTop:'1px solid #f0f0f0',padding:'16px 0',width:'100%',justifyContent:'flex-end'}}><Button disabled={busy||!!pending} onClick={reload}>读取最新材料</Button><Button disabled={disabled||!dirty} onClick={()=>write('save')}>保存草稿</Button>
      {material?.status==='draft'&&<Button type="primary" disabled={disabled||dirty||!checked} onClick={()=>write('submit')}>发送业主预览</Button>}
      {material?.status==='owner_approved'&&view?.owner&&<><Button disabled={disabled||dirty} onClick={()=>reasonAction('reject')}>退回修改</Button><Button type="primary" disabled={disabled||dirty||!checked} onClick={()=>write('publish')}>审核并公开</Button></>}
      {material&&material.status!=='withdrawn'&&<Button danger disabled={disabled||dirty} onClick={()=>reasonAction('withdraw')}>撤回公开</Button>}
    </Space>
    <Modal title="遮挡照片中的私人信息" open={!!masking} destroyOnHidden onCancel={()=>{setMasking(null);setAnchor(null);}} onOk={()=>{if(masking)edit({photos:draft.photos.map(p=>p.mediaId===masking.mediaId?masking:p)});setMasking(null);setAnchor(null);}}>
      <Typography.Paragraph>依次点击矩形的两个角，添加不透明遮挡；最多 12 处。{anchor?'已选第一个角，请点击对角。':''}</Typography.Paragraph>
      {masking&&<div onClick={addMask} style={{cursor:'crosshair'}}>{maskedPhoto(masking,photoUrl(masking))}</div>}
      <Button style={{marginTop:12}} onClick={()=>{if(masking)setMasking({...masking,masks:masking.masks.slice(0,-1)});setAnchor(null);}}>撤销上一处</Button>
    </Modal>
  </div></Spin>;
}
