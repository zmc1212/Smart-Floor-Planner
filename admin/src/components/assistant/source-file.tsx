'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Form, Input, Space, Typography } from 'antd';
import type { KnowledgeVersion } from './contracts';
import { assistantError, statusLabels } from './client';
import { notify } from '@/components/admin/operation-feedback';

function FilePicker({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  const form=Form.useFormInstance();
  const selection=useRef(0);
  return <Input type="file" accept=".docx,.pdf" aria-label="知识原件" onChange={async e=>{
    const f=e.target.files?.[0]; if(!f)return;
    const current=++selection.current;onChange?.('');form.setFieldValue('fileName',undefined);
    try {
      if(f.size>4*1024*1024 || !/\.(docx|pdf)$/i.test(f.name))throw new Error('请选择4MB以内的DOCX或可提取文字PDF。');
      let binary='';for(const b of new Uint8Array(await f.arrayBuffer()))binary+=String.fromCharCode(b);
      if(current!==selection.current)return;
      form.setFieldValue('fileName',f.name);onChange?.(btoa(binary));
    }catch(error){if(current===selection.current)notify.error(assistantError(error));}
  }} data-selected={Boolean(value)} />;
}
export function SourceFileFields() {
  return <>
    <Alert type="info" showIcon message="文件先解析核对，再索引发布" description="首批限DOCX和文字PDF，4MB以内、PDF最多50页、最多128片，正文仍限16,000字符/48,000字节。扫描、复杂版式、图示及PDF表格结构不自动理解。内部资料不会自动对客户开放。" />
    <Form.Item name="fileBase64" label="知识原件" rules={[{required:true}]}><FilePicker /></Form.Item>
    <Form.Item name="fileName" label="文件名" rules={[{required:true}]}><Input readOnly /></Form.Item>
    <Form.Item name="authorization" label="出处与使用许可" rules={[{required:true,whitespace:true,max:500}]}><Input.TextArea rows={2} maxLength={500} placeholder="原始出处、版本与可核验的使用许可；不要上传无权处理的私人资料" /></Form.Item>
  </>;
}
const warningCopy:Record<string,string>={
  docx_no_fixed_pages:'DOCX无固定页码，按章节、段落、表行列定位。',images_not_parsed:'图片和图示未解析，不能据此推断图中数值或事实。',
  pdf_reading_order_requires_review:'PDF文字顺序需对照原件核对。',pdf_tables_not_structurally_parsed:'PDF未识别表格结构，不将排列文字冒充已核实表格。',
  table_first_row_header_requires_review:'表格首行暂作表头上下文，须核对合并单元格、条件和单位。',headers_footers_not_indexed:'页眉页脚未进入检索。',
  tracked_changes_visible_text_only:'仅提取修订后的可见文字，删除内容未索引。',external_links_not_fetched:'外部链接未抓取。',
};
const failureCopy:Record<string,string>={
  knowledge_file_parse_failed:'文件未能完整解析，请核对原件是否损坏。',knowledge_file_ocr_required:'PDF有无可提取文字的页面，本批未启用OCR。',
  knowledge_file_password:'PDF需要密码，请在有权处理的前提下提供可读取副本。',knowledge_file_timeout:'解析超过本批时限，请核对或拆分原文件。',
  knowledge_file_resource_limit:'文件超过解压、页数或结构资源范围。',knowledge_file_unsafe_archive:'压缩包结构、加密或嵌入对象不在本批支持范围。',
  knowledge_file_complex_layout:'文档包含未支持的复杂结构，请核对源文件。',knowledge_file_complex_table:'嵌套表或表格行列超过本批范围。',
  knowledge_file_block_limit:'原段或表行超过本批范围，请保留条件与例外后拆分源文件。',knowledge_file_text_limit:'解析文字超过16,000字符/48,000字节。',
};
export function SourceFileReview({version,path,busy,onReview,onParse,onCancel,onReplace}:{
  version:KnowledgeVersion;path:string;busy:boolean;onReview:(excluded:string[])=>void;onParse:()=>void;onCancel:()=>void;onReplace:(values:Record<string,unknown>)=>void;
}) {
  const file=version.source_file!,[form]=Form.useForm(),[excluded,setExcluded]=useState<string[]>([]),[ack,setAck]=useState(false);
  useEffect(()=>{setExcluded(file.review?.excluded||[]);setAck(false);},[file]);
  const pending=['queued','running'].includes(version.parse_job?.status||''),readOnly=Boolean(version.published_at);
  const download=async()=>{
    try{const r=await fetch(`/api/assistant/${path}/original`,{cache:'no-store'});if(!r.ok)throw new Error('原件当前不可访问，请重新读取权限和版本。');
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){notify.error(assistantError(e));}
  };
  return <Space direction="vertical" size={16} style={{width:'100%'}}>
    <Typography.Text strong>{file.name}</Typography.Text>
    <Typography.Text type="secondary" style={{overflowWrap:'anywhere'}}>原件SHA256：{file.hash}</Typography.Text>
    <Button disabled={busy} onClick={()=>void download()}>下载当前版本原件核对</Button>
    {version.parse_job && <Alert showIcon type={version.parse_job.status==='failed'?'error':'info'} message={`解析任务：${statusLabels[version.parse_job.status]||version.parse_job.status}`}
      description={version.parse_job.last_error ? `${failureCopy[version.parse_job.last_error]||'解析未完成，请核对原件与当前权限。'}原件保留，可重试或替换文件；不会发布不完整结果。` : undefined} />}
    {pending && <Button disabled={busy} onClick={onCancel}>取消解析</Button>}
    {!readOnly && !file.parsed && !pending && <Button disabled={busy || (version.parse_job?.attempts||0)>=3} onClick={onParse}>重试本地解析</Button>}
    {file.parsed && <>
      <Typography.Text type="secondary">解析器：{file.parsed.parser}</Typography.Text>
      <Alert type="warning" showIcon message="请对照原件核对完整条件、表头、单位与例外" description={file.parsed.warnings.map(w=>warningCopy[w]||w).join(' ')} />
      <Collapse items={[{key:'blocks',label:`原件结构：${file.parsed.blocks.length}片`,children:<Space direction="vertical" style={{width:'100%'}}>{file.parsed.blocks.map(b=><div key={b.id}>
        <Checkbox disabled={busy||readOnly} checked={!excluded.includes(b.id)} onChange={e=>{setAck(false);setExcluded(e.target.checked?excluded.filter(id=>id!==b.id):[...excluded,b.id]);}}>
          {b.id} · {b.page?`PDF第${b.page}页`:b.section.join(' / ')} · {b.table?`表${b.table}第${b.row}行`:`段落${b.paragraph}`}
        </Checkbox>
        <Typography.Paragraph style={{whiteSpace:'pre-wrap',marginTop:8}}>{b.text}</Typography.Paragraph>
        {b.cells && <Typography.Text type="secondary">{b.cells.map(c=>`列${c.column}（跨度${c.span}${c.merge?'，合并'+c.merge:''}）`).join(' · ')}</Typography.Text>}
        {(b.notes||[]).map((note,i)=><Typography.Paragraph key={i} type="secondary">{note}</Typography.Paragraph>)}
      </div>)}</Space>},
      {key:'index',label:'当前将进入检索的文字',children:<Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{version.body}</Typography.Paragraph>}]} />
      {!readOnly && <><Checkbox checked={ack} disabled={busy||pending} onChange={e=>setAck(e.target.checked)}>已对照原件核对以上解析限制、完整条件与上下文；需修订原文时上传有出处的新文件。</Checkbox>
        <Button type="primary" disabled={busy||pending||!ack} onClick={()=>onReview(excluded)}>保存核对范围</Button></>}
      <Typography.Text type={file.review?'success':'warning'}>{file.review?'本版本已记录人工核对，仍需索引就绪后明确发布。':'尚未核对，不能索引或发布。'}排除片段后，其属于其他片段的原始表头/章节/脚注仍会作为上下文保留。</Typography.Text>
    </>}
    {!readOnly && <Collapse items={[{key:'replace',label:'替换草稿原件',children:<Form form={form} layout="vertical" disabled={busy||pending} onFinish={onReplace}>
      <SourceFileFields /><Button htmlType="submit" disabled={busy||pending}>保存原件并重新解析</Button>
    </Form>}]} />}
  </Space>;
}
