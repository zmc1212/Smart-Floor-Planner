'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import { assistantError, assistantRequest } from './client';
import type { RetrievalDiagnostic } from '@/lib/assistant/knowledge/retrieval';

type Diagnostic = {available:boolean;reason?:string;parser?:unknown;scope?:{audience:string;draftVersionIds:string[]};coverage?:Record<string,number>;
  generation?:{status:string;errorCode:string|null;semanticCorrectness:string};traces?:Array<Partial<Omit<RetrievalDiagnostic,'candidates'>>&{status:string;candidates?:Array<RetrievalDiagnostic['candidates'][number]&{text:string}>}>};
const labels:Record<string,string>={total:'知识总数',retired:'已撤回',unpublished:'尚未发布',audience_filtered:'当前受众排除',outside_validity:'不在有效期',index_not_ready:'索引/profile未就绪'};
export function RetrievalDiagnostics({runId}:{runId:string}) {
  const [open,setOpen]=useState(false),[result,setResult]=useState<Diagnostic|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    if (!open) return;
    const controller=new AbortController();
    void assistantRequest<Diagnostic>(`preview/runs/${runId}/diagnostics`,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setResult(r);})
      .catch(e=>{if(!controller.signal.aborted)setError(assistantError(e));});
    return()=>controller.abort();
  },[open,runId,reload]);
  return <>
    <Button onClick={()=>{setResult(null);setError('');setOpen(true);}}>检索诊断</Button>
    <Drawer title="本轮检索诊断" open={open} width={720} onClose={()=>{setOpen(false);setResult(null);}} extra={<Button onClick={()=>{setResult(null);setError('');setReload(n=>n+1);}}>重新读取</Button>}>
      {error?<Alert type="error" showIcon message={error}/>:!result?<Skeleton active/>:!result.available?<Alert type="warning" showIcon message="资料或试问范围已变化，请重新试问" description="旧候选与片段不再展示。"/>:<Space direction="vertical" size={20} style={{width:'100%'}}>
        <Alert showIcon type="info" message="查看实际检索依据，再核对回答" description="与原聊天使用相同检索配置。支持已核对的正文、FAQ、DOCX及文字PDF；扫描OCR和复杂PDF表格尚未支持。诊断不自动判断专业答案正确。"/>
        <Descriptions column={1} size="small" items={[{key:'scope',label:'试问范围',children:`${result.scope?.audience} · ${result.scope?.draftVersionIds.length?'含固定草稿':'仅发布知识'}`},
          {key:'generation',label:'回答执行',children:`${result.generation?.status}${result.generation?.errorCode?' · '+result.generation.errorCode:''}`}]} />
        <Space wrap>{Object.entries(result.coverage||{}).map(([key,value])=><Tag key={key}>{labels[key]||key} {value}</Tag>)}</Space>
        <Typography.Text type="secondary">范围计数可重叠；排除项不参与候选。固定草稿替代同文档发布版本，试问不会发布草稿。</Typography.Text>
        {!result.traces?.length && <Empty description="本轮没有执行知识检索；请结合原问题与回答核对。"/>}
        {result.traces?.map((trace,index)=><div key={index}>
          <Typography.Title level={5}>检索 {index+1}</Typography.Title>
          {trace.status!=='retrieved'?<Alert type="warning" message={trace.status==='not_ready'?'知识索引尚未就绪':'本次未取得完整检索记录，请核对执行错误或历史版本'}/>:<>
            <Typography.Paragraph>{trace.query}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">配置 {trace.configuration?.version} · profile {trace.profileId} · {trace.elapsedMs}ms · 无额外重排 · 查询输入 {trace.embeddingUsage?.inputTokens??'未知'} tokens · 费用未知</Typography.Paragraph>
            {!trace.candidates?.length?<Alert type="warning" message="当前授权范围未召回候选" description="先核对发布、受众、有效期与索引，再调整专业表述并复跑同题。"/>:<Collapse items={trace.candidates.map(c=>({key:c.ref.id,label:`${c.title} · ${c.disposition==='selected'?'检索入选':c.disposition==='below_similarity'?'相关度低':'排名未入选'}`,
              children:<Space direction="vertical" size={12}>
                <Typography.Text type="secondary">文档 {c.documentId} / 版本 {c.ref.version} / 片段 {c.ref.id} · 向量序 {c.semanticRank??'无'} · 词法序 {c.lexicalRank??'无'} · 融合序 {c.fusionRank} · 相似度 {c.similarity.toFixed(3)}</Typography.Text>
                <Typography.Text type="secondary">{c.contextIncluded===undefined?'历史记录未包含上下文装配明细':c.contextIncluded?`本轮模型使用 ${c.contextChars} 字符（原文可能按预算截取）`:'未送入本轮模型：请核对条件或上下文预算'}</Typography.Text>
                <Typography.Text>{c.applicability?({applicable:'结构条件匹配，前置检查仍须核实',unknown:'适用条件待核实',not_applicable:'当前条件明确不适用'}[c.applicability.status]):'普通条目，未登记结构条件'}</Typography.Text>
                {c.applicability && <Typography.Paragraph>{[...c.applicability.matched,...c.applicability.mismatched,...c.applicability.missing.map(s=>'缺少：'+s)].join('\n')}</Typography.Paragraph>}
                <Typography.Paragraph style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.text}</Typography.Paragraph>
              </Space>}))}/>}
          </>}
        </div>)}
      </Space>}
    </Drawer>
  </>;
}
