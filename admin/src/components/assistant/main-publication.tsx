'use client';
import { useEffect,useState } from 'react';
import { Alert,Button,Checkbox,Space,Switch,Tag } from 'antd';
import { stageDefinitions,type StageId } from '@/lib/xiaok-v1/stages';
import { notify } from '@/components/admin/operation-feedback';
import { assistantRequest,assistantError } from './client';
import { StageWechatChannel } from './stage-wechat-channel';
import { MainReportPlan } from './main-report-plan';

type Release={version:number;enabled:boolean;stages:StageId[];reports:boolean};
export function MainPublication({enterprise,tab}:{enterprise:string;tab:string}) {
  const path='publications/main?enterprise='+encodeURIComponent(enterprise);
  const [saved,setSaved]=useState<Release>(),[draft,setDraft]=useState<Release>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,reload]=useState(0);
  useEffect(()=>{
    const ac=new AbortController();
    assistantRequest<Release>(path,{signal:ac.signal}).then(r=>{if(!ac.signal.aborted){setSaved(r);setDraft(r);setError('');}})
      .catch(e=>{if(!ac.signal.aborted)setError(assistantError(e));});
    return ()=>ac.abort();
  },[path,revision]);
  async function publish(enabled:boolean) {
    if(!draft || !saved || busy)return;
    setBusy(true);
    try {
      const {stages,reports}=draft;
      const value=await assistantRequest<Release>(path,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:saved.version,enabled,stages,reports})});
      setSaved(value);setDraft(value);setError('');notify.success(enabled?'主小K已发布':'主小K已停用');
    }catch(e){setError(assistantError(e));notify.error(assistantError(e));}finally{setBusy(false);}
  }
  if(tab==='报告计划') return <section className="ss-other"><MainReportPlan enterprise={enterprise}/></section>;
  return <section className="ss-other"><h2>主小K</h2>
    {error && <Alert showIcon type="error" message={error} action={<Button onClick={()=>reload(v=>v+1)}>重新读取</Button>}/>}
    {saved && draft && (tab==='发布渠道' ? <>
      <h3>业主小程序</h3><Tag color={saved.enabled?'green':undefined}>{saved.enabled?'已发布 v'+saved.version:'未发布'}</Tag>
      <StageWechatChannel enterprise={enterprise} stage="main" enabled={saved.enabled}/>
    </>:<><h3>装修阶段</h3>
      <Checkbox.Group value={draft.stages} disabled={busy} options={stageDefinitions.map(s=>({label:s.name,value:s.stageId}))}
        onChange={v=>setDraft({...draft,stages:v as StageId[]})}/>
      <h3>工地报告</h3><Space><Switch aria-label="启用工地报告" checked={draft.reports} disabled={busy}
        onChange={reports=>setDraft({...draft,reports})}/>日报与周报</Space>
      <p>发布后，小程序和微信共用选中的阶段与报告能力。</p>
      <Space><Button type="primary" loading={busy} onClick={()=>publish(true)}>发布主小K</Button>
        {saved.enabled && <Button disabled={busy} onClick={()=>publish(false)}>停用主小K</Button>}
        <Tag>{saved.enabled?'已发布 v'+saved.version:'未发布'}</Tag></Space></>)}
  </section>;
}
