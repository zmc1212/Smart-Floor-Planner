'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, List, Space, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, AssistantRequestError, assistantError, assistantRequest } from './client';
import { HandoffMedia } from './handoff-media';
type Message={id:string;authorKind:string;text:string};
type Handoff={state:string;recipientName:string;ownerName?:string;mediaConsent?:boolean;contactConsent?:boolean;phone?:string;source?:{kind:string;id?:string};packet?:{messages:Message[];summary?:{status:string;draft_fields:Record<string,{text:string}>;confirmed_fields?:Record<string,string>}}};
type Item={conversationId:string;title:string;handoff:Handoff};
type Detail={conversationId:string;handoff:Handoff;messages:Message[]};
const labels:Record<string,string>={housing:'房屋',household:'居住需求',style:'风格',budget:'预算',timeline:'时间',room:'房间',space:'空间偏好',usage:'使用方式',frequency:'频率',devices:'设备'};
export function HandoffPanel() {
  const [items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Detail>();
  const [text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [pending,setPending]=useState<{action:string;text?:string}>();
  const mutations=useMemo(()=>new AssistantMutations(),[]);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{
      try {
        if(selected){const data=await assistantRequest<Detail>('handoffs/'+selected,{signal:controller.signal});if(!controller.signal.aborted)setDetail(data);}
        else {const data=await assistantRequest<{items:Item[]}>('handoffs',{signal:controller.signal});if(!controller.signal.aborted)setItems(data.items);}
        if(!controller.signal.aborted){setError('');timer=setTimeout(load,3000);}
      }catch(e){if(!controller.signal.aborted){setDetail(undefined);setItems([]);setError(assistantError(e));}}
    };
    if(!busy)void load();return()=>{controller.abort();clearTimeout(timer);};
  },[selected,revision,busy]);
  const act=async(action:string)=>{
    if(busy)return;
    const body=pending||{action,...(action==='reply'?{text:text.trim()}: {})};
    if(body.action==='reply'&&!body.text)return;
    setBusy(true);
    try {
      await mutations.write('handoffs/'+selected,body);
      setPending(undefined);setText('');notify.success('接续操作已保存');
      if(['end','release'].includes(body.action)){setSelected('');setDetail(undefined);}
      setRevision(n=>n+1);
    }catch(e){setError(assistantError(e));notify.error('操作未完成',{description:assistantError(e)});setPending(e instanceof AssistantRequestError&&e.uncertain?body:undefined);}
    finally{setBusy(false);}
  };
  const summary=detail?.handoff.packet?.summary;
  return <Space direction="vertical" size={16} style={{width:'100%'}}>
    <Alert type="info" showIcon message="仅展示客户授权给企业接待团队或你的咨询" description="本企业负责人可接管并在同一会话回复。平台知识管理权限不授予客户咨询访问权。接待人、原始来源与分佣各自保留。" />
    {error&&<Alert type="error" message={error} action={<Button onClick={()=>setRevision(n=>n+1)}>刷新</Button>} />}
    {pending&&<Alert type="warning" message="上次写入结果待确认" action={<Button loading={busy} onClick={()=>void act(pending.action)}>核对同一次操作</Button>} />}
    {!selected?<List dataSource={items} locale={{emptyText:'暂无授权咨询'}} renderItem={item=><List.Item actions={[<Button key="open" onClick={()=>{setSelected(item.conversationId);setDetail(undefined);}}>查看咨询</Button>]}><List.Item.Meta title={item.title} description={item.handoff.recipientName}/><Tag>{item.handoff.state==='waiting'?'待接管':'你已接管'}</Tag></List.Item>}/>:<>
      <Button disabled={busy||!!pending} onClick={()=>{setSelected('');setDetail(undefined);}}>返回咨询队列</Button>
      {detail&&<>
        {detail.handoff.state==='active' && detail.handoff.mediaConsent && <Card title="授权图片资料"><HandoffMedia key={detail.conversationId} conversationId={detail.conversationId} /></Card>}
        <Card title={detail.handoff.state==='waiting'?'待接管':'真人接续中'}>
          <Descriptions column={1} items={[
            {key:'recipient',label:'接待范围',children:detail.handoff.ownerName||detail.handoff.recipientName},
            ...(detail.handoff.source ? [{key:'source',label:'原始来源',children:detail.handoff.source.kind+' / '+(detail.handoff.source.id||'')}] : []),
            ...(detail.handoff.state==='active' ? [{key:'contact',label:'联系授权',children:detail.handoff.contactConsent?detail.handoff.phone:'未授权电话联系，仅会话沟通'}] : []),
            ...Object.entries(summary?.draft_fields||{}).map(([key,value])=>({key,label:labels[key]||key,children:<><Typography.Text>{summary?.confirmed_fields?.[key]??value.text??'待补充'}</Typography.Text><br/><Typography.Text type="secondary">原话参考：{value.text||'暂无'}</Typography.Text></>})),
          ]}/>
        </Card>
        {detail.handoff.state==='active' && <Card title="同一会话"><List dataSource={detail.messages} renderItem={m=><List.Item><Space direction="vertical"><Tag>{m.authorKind==='user'?'客户原话':m.authorKind==='admin'?'真人回复':m.authorKind==='system'?'服务提示':'小K参考'}</Tag><Typography.Paragraph style={{whiteSpace:'pre-wrap',margin:0}}>{m.text}</Typography.Paragraph></Space></List.Item>}/></Card>}
        {detail.handoff.state==='waiting'?<Button type="primary" loading={busy} disabled={!!pending} onClick={()=>void act('claim')}>接管并开始沟通</Button>:<>
          <Input.TextArea rows={3} value={text} onChange={e=>setText(e.target.value)} maxLength={4000} disabled={busy||!!pending} placeholder="回复客户"/>
          <Space><Button type="primary" loading={busy} disabled={!!pending||!text.trim()} onClick={()=>void act('reply')}>发送真人回复</Button><Button disabled={busy||!!pending} onClick={()=>void act('release')}>退出接待</Button><Button disabled={busy||!!pending} onClick={()=>void act('end')}>结束接续，恢复小K</Button></Space>
        </>}
      </>}
    </>}
  </Space>;
}
