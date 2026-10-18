'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Form, Input, List, Popconfirm, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { notify } from '@/components/admin/operation-feedback';
import { AssistantMutations, assistantError, assistantRequest, formatTime, statusLabels } from './client';
import { RetrievalDiagnostics } from './retrieval-diagnostics';
import { KnowledgeBatches } from './knowledge-batches';
import type { KnowledgeExpectation } from '@/lib/assistant/knowledge/evaluation-check';
import type {MessageContent} from '@/lib/assistant/contracts';
type Case={id:string;title:string;question:string;expectation:KnowledgeExpectation;version:number;revision:number;gap_status:string;gap_note:string};
type Health={sources:Array<{id:string;title:string;audience:string;status:string}>;indexes:Record<string,number>;jobs:Array<{kind:string;status:string;count:number;expired_leases:number;oldest_at:string}>;
  attempts:Array<{operation:string;status:string;calls:number;known_input_tokens:string|null;unknown_input_calls:number}>;profile:{profile_key:string;status:string}|null;knowledgeEpoch:number;note:string};
type Evaluation={id:string;available:boolean;status?:string;conversationId?:string;run?:{id:string;errorCode:string|null};caseRevision?:number;
  snapshot?:{title:string;question:string;required:Array<{documentId:string;versionId:string}>};
  structural?:{passed:boolean;missingRecall:string[];missingSelected:string[];missingCitations:string[];forbidden:string[]};
  answer?:{content:MessageContent};review?:{outcome:string;note:string};usage?:Array<Record<string,string|null>>};
type Usage={budget:{requests:string;tokens:string;cost_micros:string;pending_reviews:string};limits:{requests:string;tokens:string;costMicros:string};usage:Array<{day:string;category:string;measurement_kind:string;quantity:string|null;unknown_input_records:string;unknown_output_records:string}>};
const base='knowledge/operations/';
const gapLabel:Record<string,string>={open:'待修订/核对',verified:'本版已核对',needs_recheck:'来源已变化，待复跑'};
export function KnowledgeOperationsPanel({canUsage}:{canUsage:boolean}) {
  const [items,setItems]=useState<Case[]>([]),[cursor,setCursor]=useState<string|null>(null),[health,setHealth]=useState<Health|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Case|'new'|null>(null);
  const [selected,setSelected]=useState<Case|null>(null),[history,setHistory]=useState<Array<{id:string;case_revision:number;created_at:string}>>([]),[historyCursor,setHistoryCursor]=useState<string|null>(null);
  const [evaluation,setEvaluation]=useState<Evaluation|null>(null),[evaluationId,setEvaluationId]=useState<string|null>(null),[evaluationError,setEvaluationError]=useState(''),[note,setNote]=useState('');
  const [evaluationReload,setEvaluationReload]=useState(0),[reloadedQuestion,setReloadedQuestion]=useState<string|null>(null);
  const [usage,setUsage]=useState<Usage>(),[usageError,setUsageError]=useState('');
  const [batchSelection,setBatchSelection]=useState<string[]>([]);
  const [form]=Form.useForm();const mutations=useRef(new AssistantMutations()),lock=useRef(false),selection=useRef<string|null>(null);
  const load=useCallback(async(before?:string,signal?:AbortSignal)=>{
    if(!before)setBatchSelection([]);
    setLoading(true);setError('');
    try{const [list,h]=await Promise.all([assistantRequest<{items:Case[];nextCursor:string|null}>(base+'cases'+(before?'?beforeId='+before:''),{signal}),assistantRequest<Health>(base+'health',{signal})]);
      if(signal?.aborted)return;setItems(prev=>before?[...prev,...list.items]:list.items);setCursor(list.nextCursor);setHealth(h);
    }catch(e){if(!signal?.aborted){setError(assistantError(e));setItems([]);setHealth(null);}}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  const reloadBatchCases=useCallback(()=>{setBatchSelection([]);void load();},[load]);
  const clearBatchSelection=useCallback(()=>setBatchSelection([]),[]);
  useEffect(()=>{const c=new AbortController();void load(undefined,c.signal);return()=>c.abort();},[load]);
  useEffect(()=>{
    if(!evaluationId)return;const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setEvaluation(null);setEvaluationError('');
    const read=async()=>{try{const r=await assistantRequest<Evaluation>(base+'evaluations/'+evaluationId,{signal:c.signal});if(c.signal.aborted)return;setEvaluation(r);setEvaluationError('');if(['queued','running'].includes(r.status||''))timer=setTimeout(read,1800);}
      catch(e){if(!c.signal.aborted){setEvaluation(null);setEvaluationError(assistantError(e));}}};void read();return()=>{c.abort();clearTimeout(timer);};
  },[evaluationId,evaluationReload]);
  const select=async(row:Case,before?:string)=>{
    selection.current=row.id;setSelected(row);if(!before)setHistory([]);setEvaluationId(null);setEvaluation(null);setEvaluationError('');setNote('');
    try{const r=await assistantRequest<{items:typeof history;nextCursor:string|null}>(base+`cases/${row.id}/evaluations`+(before?'?beforeId='+before:''));
      if(selection.current!==row.id)return;setHistory(prev=>before?[...prev,...r.items]:r.items);setHistoryCursor(r.nextCursor);
    }catch(e){if(selection.current===row.id){setHistory([]);setEvaluationError(assistantError(e));}}
  };
  const operate=async(work:()=>Promise<void>,message:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);
    try{await work();notify.success(message);await load();}catch(e){setError(assistantError(e));notify.error(assistantError(e));}finally{lock.current=false;setBusy(false);}
  };
  const edit=(row:Case|'new')=>{setEditing(row);setReloadedQuestion(null);form.setFieldsValue(row==='new'?{title:'',question:'',kind:'grounded',requiredDocumentIds:[],forbiddenDocumentIds:[],gapNote:''}:
    {title:row.title,question:row.question,...row.expectation,gapNote:row.gap_note});};
  const save=async()=>{
    const values=await form.validateFields();await operate(async()=>{
      const body={title:values.title,question:values.question,expectation:{kind:values.kind,requiredDocumentIds:values.kind==='missing'?[]:values.requiredDocumentIds||[],forbiddenDocumentIds:values.forbiddenDocumentIds||[]},gapNote:values.gapNote||'',...(editing&&editing!=='new'?{expectedVersion:editing.version}:{})};
      await mutations.current.write(base+'cases'+(editing&&editing!=='new'?'/'+editing.id:''),body,editing==='new'?'POST':'PATCH');setEditing(null);setSelected(null);setEvaluationId(null);
    },'问题与缺口已保存');
  };
  const start=(row:Case)=>operate(async()=>{const r=await mutations.current.write<{evaluationId:string}>(base+`cases/${row.id}/evaluations`,{expectedVersion:row.version});
    await select(row);setEvaluationId(r.evaluationId);
  },'同题复跑已提交，将使用本企业试问额度');
  const review=(outcome:string)=>operate(async()=>{if(!selected||!evaluation)return;
    const row=await mutations.current.write<Case>(base+`evaluations/${evaluation.id}/review`,{expectedVersion:selected.version,outcome,note});
    setSelected(row);setEvaluation(await assistantRequest<Evaluation>(base+'evaluations/'+evaluation.id));setNote('');
  },outcome==='accepted'?'本版核对结果已保存':'缺口已保留，修订后可复跑');
  const sourceOptions=(health?.sources||[]).map(s=>({value:s.id,label:`${s.title} · ${s.audience==='customer_public'?'客户可见':'内部'} · ${statusLabels[s.status]||s.status}`}));
  const openBatchEvaluation=async(caseId:string,id:string)=>{
    try{const row=await assistantRequest<Case>(base+'cases/'+caseId);await select(row);if(selection.current===row.id){setEvaluationId(id);setEvaluationReload(value=>value+1);}}
    catch(error){setError(assistantError(error));notify.error(assistantError(error));}
  };
  const expectedKind=Form.useWatch('kind',form);
  const cancelEvaluation=()=>operate(async()=>{
    if(!evaluation)return;
    await mutations.current.write(base+`evaluations/${evaluation.id}/cancel`,{});
    setEvaluation(null);setEvaluationReload(n=>n+1);
  },'已核对原次取消请求，请以重新读取的执行状态和用量为准');
  return <Space direction="vertical" size={20} style={{width:'100%'}}>
    <Alert type="info" showIcon message="固定问题，修订后复跑同题" description="问题由管理者整理，企业内共享；每次复跑固定当前修订及已发布来源版本，沿用仅本人可见的管理员试问和原Worker。召回、入选、引用检查通过后，仍需核对回答的专业含义；不会自动生成施工事项或企业规则。"/>
    {error&&<Alert type="error" showIcon message={error} action={<Button onClick={()=>void load()}>重新读取</Button>}/>}
    <Space wrap><Button type="primary" disabled={busy} onClick={()=>edit('new')}>新增问题/缺口</Button><Button loading={loading} disabled={busy} onClick={()=>void load()}>刷新</Button>
      <KnowledgeBatches selected={batchSelection.flatMap(id=>{const item=items.find(row=>row.id===id);return item?[{id:item.id,version:item.version}]:[];})} disabled={busy||loading}
        onPrepared={clearBatchSelection} onReloadCases={reloadBatchCases} onOpenEvaluation={openBatchEvaluation}/>
    </Space>
    <Table<Case> rowKey="id" loading={loading} dataSource={items} pagination={false} scroll={{x:850}} rowSelection={{selectedRowKeys:batchSelection,
      onChange:keys=>{if(keys.length>50){notify.error('一次最多选择50道问题');return;}setBatchSelection(keys.map(String));},
      getCheckboxProps:row=>({disabled:busy||loading||(batchSelection.length>=50&&!batchSelection.includes(row.id))})}}
      locale={{emptyText:<Empty description="暂无问题集，先记录需要反复核对的真实业务问法。"/>}} columns={[
      {title:'问题',dataIndex:'title',render:(_,r)=><Button type="link" onClick={()=>void select(r)}>{r.title}</Button>},
      {title:'问题修订',dataIndex:'revision',width:100},{title:'缺口状态',dataIndex:'gap_status',render:v=><Tag>{gapLabel[v]||v}</Tag>},
      {title:'预期',dataIndex:'expectation',render:v=>v.kind==='grounded'?'有依据回答':'明确依据不足'},
      {title:'操作',render:(_,r)=><Space><Button disabled={busy} onClick={()=>edit(r)}>编辑</Button><Button disabled={busy} onClick={()=>void start(r)}>复跑同题</Button></Space>},
    ]}/>
    {cursor&&<Button loading={loading} onClick={()=>void load(cursor)}>加载更多问题</Button>}
    <Collapse items={[{key:'health',label:'索引健康与用量',children:!health?<Skeleton active/>:<Space direction="vertical" size={16} style={{width:'100%'}}>
      <Descriptions column={2} items={[{key:'profile',label:'当前索引',children:health.profile?.profile_key||'尚未建立'},{key:'epoch',label:'知识修订',children:String(health.knowledgeEpoch)},
        {key:'documents',label:'知识文档',children:health.indexes.documents},{key:'ready',label:'当前有效且索引就绪',children:health.indexes.effective_ready},
        {key:'files',label:'文件文档',children:health.indexes.files},{key:'mismatch',label:'发布索引不一致',children:health.indexes.index_mismatch}]}/>
      <Typography.Text type="secondary">{health.note} 当前支持DOCX/文字PDF，扫描OCR及复杂PDF表格尚未支持。问题最多100条，每条固定最多5份必需/禁止来源；此处来源选项最多显示200份。</Typography.Text>
      <Table rowKey={r=>r.kind+':'+r.status} size="small" pagination={false} dataSource={health.jobs} columns={[{title:'任务',dataIndex:'kind'},{title:'状态',dataIndex:'status',render:v=>statusLabels[v]||v},{title:'数量',dataIndex:'count'},{title:'过期租约',dataIndex:'expired_leases'},{title:'最早创建',dataIndex:'oldest_at',render:formatTime}]}/>
      <Table rowKey={r=>r.operation+':'+r.status} size="small" pagination={false} dataSource={health.attempts} columns={[{title:'近30天索引调用',dataIndex:'operation'},{title:'状态',dataIndex:'status'},{title:'次数',dataIndex:'calls'},{title:'已知输入tokens',dataIndex:'known_input_tokens',render:v=>v??'未知'},{title:'输入用量未知次数',dataIndex:'unknown_input_calls'}]}/>
      <Typography.Text type="secondary">费用未知。索引调用不等于聊天用量，健康计数不代表外部服务实时连通。</Typography.Text>
      {canUsage?<><Button onClick={()=>{setUsageError('');void assistantRequest<Usage>('usage').then(setUsage).catch(e=>{setUsage(undefined);setUsageError(assistantError(e));});}}>读取已授权企业用量</Button>{usageError&&<Alert type="error" message={usageError}/>} {usage&&<>
        <Descriptions column={2} items={[{key:'requests',label:'今日已占用请求',children:`${usage.budget.requests} / ${usage.limits.requests}`},{key:'tokens',label:'今日已占用tokens',children:`${usage.budget.tokens} / ${usage.limits.tokens}`},{key:'unknown',label:'费用待核对请求',children:usage.budget.pending_reviews}]}/>
        <Typography.Text type="secondary">占用含未决预留，费用未知不记零。以下为原用量记录，不含上表单列的入库索引调用。</Typography.Text>
        <Table size="small" pagination={false} rowKey={r=>r.day+':'+r.category+':'+r.measurement_kind} dataSource={usage.usage} columns={[{title:'日期(UTC)',dataIndex:'day'},{title:'类别',dataIndex:'category'},{title:'计量',dataIndex:'measurement_kind'},{title:'已知用量',dataIndex:'quantity',render:v=>v??'未知'},{title:'输入未知记录',dataIndex:'unknown_input_records'},{title:'输出未知记录',dataIndex:'unknown_output_records'}]}/>
      </>}</>:<Typography.Text type="secondary">企业聊天用量仍按原独立用量授权读取。</Typography.Text>}
    </Space>}]}/>
    <Drawer title={editing==='new'?'新增问题/缺口':'编辑问题与预期'} open={!!editing} width={720} onClose={()=>{if(!busy)setEditing(null);}} extra={<Space>{editing&&editing!=='new'&&<Button disabled={busy} onClick={()=>void operate(async()=>{const current=await assistantRequest<Case>(base+'cases/'+editing.id);setEditing(current);setReloadedQuestion(current.question);},'已读取最新版本，你的输入仍保留，请核对后保存')}>重读并保留输入</Button>}<Button type="primary" loading={busy} onClick={()=>void save().catch(()=>{})}>保存问题</Button></Space>}>
      {reloadedQuestion!==null&&<Alert type="warning" showIcon message="已保存的当前问法；你的编辑仍保留" description={reloadedQuestion} style={{marginBottom:20}}/>}
      <Form form={form} layout="vertical" disabled={busy}><Form.Item name="title" label="问题名称" rules={[{required:true,whitespace:true}]}><Input maxLength={120}/></Form.Item>
        <Form.Item name="question" label="固定问法" rules={[{required:true,whitespace:true}]}><Input.TextArea rows={4} maxLength={2000} showCount/></Form.Item>
        <Form.Item name="kind" label="预期回答"><Select options={[{value:'grounded',label:'应有依据回答'},{value:'missing',label:'应明确依据不足'}]}/></Form.Item>
        {expectedKind!=='missing'&&<Form.Item name="requiredDocumentIds" label="必须召回、入选并引用的来源" rules={[{required:true,type:'array',min:1,max:5}]}><Select mode="multiple" maxCount={5} options={sourceOptions} optionFilterProp="label"/></Form.Item>}
        <Form.Item name="forbiddenDocumentIds" label="不得出现在候选或引用中的来源"><Select mode="multiple" maxCount={5} options={sourceOptions} optionFilterProp="label"/></Form.Item>
        <Form.Item name="gapNote" label="专业核对重点 / 当前缺口"><Input.TextArea rows={4} maxLength={2000}/></Form.Item>
      </Form><Alert type="info" message="复跑时固定必需来源的当前已发布有效版本；未发布或索引失败时会提示处理，原有效旧版保持。修改问法或预期后生成新修订，旧结果不自动沿用。"/>
    </Drawer>
    <Drawer title="同题回归与缺口核对" open={!!selected} width={720} onClose={()=>{selection.current=null;setSelected(null);setHistory([]);setEvaluationId(null);setEvaluation(null);}}>
      {selected&&<Space direction="vertical" size={20} style={{width:'100%'}}><Typography.Title level={5}>{selected.title}</Typography.Title><Typography.Paragraph>{selected.question}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">{gapLabel[selected.gap_status]} · {selected.gap_note}</Typography.Paragraph><Button loading={busy} onClick={()=>void start(selected)}>按当前有效资料复跑</Button>
        <List dataSource={history} locale={{emptyText:'本人尚未复跑此题'}} renderItem={r=><List.Item><Button type="link" onClick={()=>{setEvaluation(null);setEvaluationId(r.id);setEvaluationReload(n=>n+1);setNote('');}}>问题修订 {r.case_revision} · {formatTime(r.created_at)}</Button></List.Item>}/>
        {historyCursor&&<Button onClick={()=>void select(selected,historyCursor)}>加载更早复跑</Button>}
        {evaluationId&&<Button onClick={()=>{setEvaluation(null);setEvaluationError('');setEvaluationReload(n=>n+1);}}>重新读取结果</Button>}
        {evaluationError&&<Alert type="error" message={evaluationError}/>}
        {evaluationId&&!evaluation&&!evaluationError&&<Skeleton active/>}
        {evaluation&&!evaluation.available&&<Alert type="warning" showIcon message="来源或问题修订已变化，旧回答与诊断已收起，请复跑当前版本。"/>}
        {evaluation?.available&&<>
          <Tag>{statusLabels[evaluation.status||'']||evaluation.status}</Tag>
          {evaluation.status==='dispatch_pending'&&<Button loading={busy} onClick={()=>void operate(async()=>{await mutations.current.write(base+`evaluations/${evaluation.id}/resume`,{});setEvaluation(null);setEvaluationReload(n=>n+1);},'已用原键恢复复跑')}>恢复原次执行</Button>}
          {['queued','running'].includes(evaluation.status||'')&&<Popconfirm title="取消本次执行？" description="已提交的调用仍可能产生用量，取消后不会自动重跑。" disabled={busy} onConfirm={cancelEvaluation}><Button disabled={busy}>取消原次执行</Button></Popconfirm>}
          {evaluation.run?.errorCode&&<Alert type="error" message={assistantError(new Error(evaluation.run.errorCode))}/>}
          {evaluation.structural&&<Alert type={evaluation.structural.passed?'success':'warning'} message={evaluation.structural.passed?'来源结构检查通过，专业含义待核对':'来源结构检查未通过或仍在执行'} description={`未召回 ${evaluation.structural.missingRecall.length} · 未入选 ${evaluation.structural.missingSelected.length} · 未引用 ${evaluation.structural.missingCitations.length} · 禁止来源 ${evaluation.structural.forbidden.length}`}/>}
          {evaluation.answer&&<Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{evaluation.answer.content.blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n\n')||'请打开本人试问核对结构回答。'}</Typography.Paragraph>}
          {evaluation.conversationId&&<a href={'/assistant-knowledge?preview='+evaluation.conversationId} target="_blank" rel="noreferrer">打开本人原试问与引用</a>}
          {evaluation.run&&<RetrievalDiagnostics runId={evaluation.run.id}/>}
          {evaluation.usage?.map((u,i)=><Typography.Text type="secondary" key={i}>{u.category} · {u.measurement_kind} · 用量 {u.quantity??'未知'} · 费用 {u.cost_micros??'未知'}</Typography.Text>)}
          {evaluation.review&&<Alert type="info" message={evaluation.review.outcome==='accepted'?'管理者已核对本版':'管理者保留缺口'} description={evaluation.review.note}/>}
          {['succeeded','failed','cancelled','indeterminate'].includes(evaluation.status||'')&&<><Input.TextArea value={note} onChange={e=>setNote(e.target.value)} rows={3} maxLength={2000} placeholder="核对依据、专业要点及待修订内容（至少5字）"/>
            <Space wrap><Button loading={busy} disabled={!evaluation.structural?.passed||note.trim().length<5} onClick={()=>void review('accepted')}>确认本版核对通过</Button><Button loading={busy} disabled={note.trim().length<5} onClick={()=>void review('rejected')}>保留缺口</Button></Space></>}
        </>}
      </Space>}
    </Drawer>
  </Space>;
}
