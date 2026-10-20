'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Form, Input, List, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, AssistantRequestError, assistantError, assistantRequest, formatTime, statusLabels } from './client';

type Target={id:string;title:string;version:number};
type Batch={id:string;available:boolean;title?:string;state:string;version:number;concurrency?:number;errorCode?:string;
  knowledgeEpoch?:number;items?:Array<{evaluationId:string;caseId:string;title:string;revision:number;ordinal:number;status:string;errorCode:string|null;awaitingReconciliation:boolean}>;
  configuration?:{models:Array<{model:string}>};
  usage?:{records:number;known_input_tokens:string|null;known_output_tokens:string|null;known_cost_micros:string|null;unknown_token_records:number;unknown_cost_records:number}};
type Summary={id:string;title:string;state:string;version:number;created_at:string};
const base='knowledge/operations/batches';
const labels:Record<string,string>={active:'正在执行',blocked:'执行已暂停',completed:'本批执行结束',cancelled:'已取消',pending:'等待提交'};
export function KnowledgeBatchesPanel({targets,onClear,onEvaluation}:{targets:Target[];onClear:()=>void;onEvaluation:(caseId:string,evaluationId:string)=>void}) {
  const [items,setItems]=useState<Summary[]>([]),[id,setId]=useState<string|null>(null),[detail,setDetail]=useState<Batch|null>(null);
  const [creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[listLoading,setListLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [form]=Form.useForm(),mutations=useRef(new AssistantMutations()),locked=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setListLoading(true);setError('');
    try{const r=await assistantRequest<{items:Summary[]}>(base,{signal});if(!signal?.aborted)setItems(r.items);}
    catch(e){if(!signal?.aborted){setItems([]);setError(assistantError(e));}}
    finally{if(!signal?.aborted)setListLoading(false);}
  },[]);
  useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort();},[load]);
  useEffect(()=>{
    if(!id)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setDetail(null);setError('');
    const read=async()=>{try{const r=await assistantRequest<Batch>(base+'/'+id,{signal:c.signal});if(c.signal.aborted)return;setDetail(r);setError('');
      if(r.available&&r.state==='active')timer=setTimeout(read,1800);
    }catch(e){if(!c.signal.aborted){setDetail(null);setError(assistantError(e));}}};void read();
    return()=>{c.abort();clearTimeout(timer);};
  },[id,reload]);
  const write=async(work:()=>Promise<void>,message:string)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await work();notify.success(message);await load();}catch(e){setError(assistantError(e));notify.error(assistantError(e));}finally{setBusy(false);locked.current=false;}
  };
  const create=async()=>{
    const v=await form.validateFields();
    await write(async()=>{const r=await mutations.current.write<{batchId:string}>(base,{title:v.title,cases:targets.map(t=>({id:t.id,expectedVersion:t.version})),concurrency:v.concurrency});
      setCreating(false);onClear();setId(r.batchId);setReload(n=>n+1);
    },'批量复跑已保存，原Worker将继续逐题执行');
  };
  const command=(action:'cancel'|'resume')=>write(async()=>{
    if(!detail)return;await mutations.current.write(base+'/'+detail.id+'/'+action,{expectedVersion:detail.version});setReload(n=>n+1);
  },action==='cancel'?'已取消后续执行，在途费用仍按原记录核对':'已按原键恢复本批执行');
  return <Space direction="vertical" style={{width:'100%'}}>
    <Space wrap><Button disabled={!targets.length||targets.length>20||busy} onClick={()=>{setCreating(true);form.setFieldsValue({title:'知识问题批量回归',concurrency:1});}}>批量复跑选中问题（{targets.length}）</Button>
      {targets.length>20&&<Typography.Text type="warning">每批最多20题</Typography.Text>}</Space>
    <Collapse items={[{key:'batches',label:'本人批量回归',children:<Space direction="vertical" style={{width:'100%'}}>
      <Button loading={listLoading} onClick={()=>void load()}>刷新批次</Button>
      <List loading={listLoading} dataSource={items} locale={{emptyText:<Empty description="本人尚无批量回归"/>}} renderItem={b=><List.Item><Button type="link" onClick={()=>{setId(b.id);setReload(n=>n+1);}}>{b.title} · {formatTime(b.created_at)}</Button></List.Item>}/>
    </Space>}]}/>
    <Drawer title="创建批量回归" open={creating} width={720} onClose={()=>{if(!busy)setCreating(false);}} extra={<Button type="primary" loading={busy} onClick={()=>void create().catch(()=>{})}>保存并执行</Button>}>
      <Form form={form} name="knowledge-batch-create" layout="vertical" disabled={busy}><Form.Item name="title" label="批次名称" rules={[{required:true,whitespace:true}]}><Input maxLength={120}/></Form.Item>
        <Form.Item name="concurrency" label="最多同时执行题数"><Select options={[1,2,3].map(v=>({value:v,label:String(v)}))}/></Form.Item></Form>
      <List dataSource={targets} renderItem={t=><List.Item>{t.title}</List.Item>}/>
      <Alert type="info" showIcon message="固定本批问题与有效资料" description="保存时固定选中问题修订、必需来源版本、索引与模型配置。每题沿用本人试问、原Worker与企业额度；关闭页面仍继续，重开可读进度或用原键恢复。知识或问法变化会收起旧结果，需要新建批次。结构检查不代替专业核对，不自动关闭缺口。"/>
      {error&&<Alert type="error" message={error}/>}
    </Drawer>
    <Drawer title="批量回归进度" open={!!id} width={720} onClose={()=>{setId(null);setDetail(null);}} extra={<Button onClick={()=>setReload(n=>n+1)}>重新读取</Button>}>
      {error&&<Alert type="error" message={error}/>}{!detail&&!error&&<Skeleton active/>}
      {detail&&<Space direction="vertical" size={20} style={{width:'100%'}}>
        {!detail.available?<Alert type="warning" showIcon message="问题、来源或执行配置已变化，旧结果已收起。取消后可按当前资料新建批次。"/>:<>
          <Typography.Title level={5}>{detail.title}</Typography.Title><Tag>{labels[detail.state]||detail.state}</Tag>
          <Descriptions column={2} items={[{key:'total',label:'固定题数',children:detail.items?.length},{key:'completed',label:'已结束',children:detail.items?.filter(i=>['succeeded','failed','cancelled','indeterminate'].includes(i.status)).length},
            {key:'concurrency',label:'同时执行上限',children:detail.concurrency},{key:'epoch',label:'知识修订',children:String(detail.knowledgeEpoch)},
            {key:'models',label:'固定试问模型',children:detail.configuration?.models.map(m=>m.model).join(' / ')||'无可用模型'}]}/>
          {detail.errorCode&&<Alert type="warning" message={assistantError(new AssistantRequestError(detail.errorCode,409))}/>}
          <Table rowKey="evaluationId" size="small" pagination={false} dataSource={detail.items} columns={[
            {title:'问题',dataIndex:'title'},{title:'修订',dataIndex:'revision'},{title:'执行状态',dataIndex:'status',render:(v,r)=><Space direction="vertical"><Tag>{labels[v]||statusLabels[v]||v}</Tag>{r.awaitingReconciliation&&<Typography.Text type="warning">调用费用待核对</Typography.Text>}</Space>},
            {title:'结果',render:(_,r)=><Button type="link" onClick={()=>{setId(null);onEvaluation(r.caseId,r.evaluationId);}}>查看原次结果</Button>},
          ]}/>
          {detail.usage&&<Typography.Text type="secondary">已知输入 {detail.usage.known_input_tokens??'未知'} tokens · 已知输出 {detail.usage.known_output_tokens??'未知'} tokens · 用量有未知的记录 {detail.usage.unknown_token_records} · 费用未知记录 {detail.usage.unknown_cost_records}。仅为已知小计，未知费用不记零。</Typography.Text>}
          {detail.state==='blocked'&&<Button loading={busy} onClick={()=>void command('resume')}>用原键恢复本批</Button>}
        </>}
        {detail.state!=='cancelled'&&detail.state!=='completed'&&<Button danger loading={busy} onClick={()=>void command('cancel')}>取消本批后续执行</Button>}
      </Space>}
    </Drawer>
    {error&&!creating&&!id&&<Alert type="error" message={error}/>}
  </Space>;
}
