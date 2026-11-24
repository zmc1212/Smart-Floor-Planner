'use client';
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,Input,Select,Space,Switch} from 'antd';
import {notify} from '@/components/admin/operation-feedback';
import {stageDefinitions} from '@/lib/xiaok-v1/stages';
import {assistantError,assistantRequest} from './client';

type Plan={version:number;enabled:boolean;stageEnabled:boolean;dailyTime:string;weeklyDay:number;weeklyTime:string;
  projectIds:string[];stageKeys:string[];audiences:string[];inactivePolicy:string};
type Project={id:string;name:string};
type Page={settings:Plan;projects:Project[];selectedProjects:Project[];nextCursor:string|null;projectLimitExceeded:boolean};
const roles=[['customer','业主'],['worker','施工人员'],['designer','设计师'],['boss','老板']].map(([value,label])=>({value,label}));
export function MainReportPlan({enterprise}:{enterprise:string}) {
  const path='publications/main/plan?enterprise='+encodeURIComponent(enterprise);
  const [plan,setPlan]=useState<Plan>(),[projects,setProjects]=useState<Project[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[epoch,reload]=useState(0);
  const [projectLimitExceeded,setProjectLimitExceeded]=useState(false);
  const attempt=useRef<{key:string;body:string}|null>(null);
  useEffect(()=>{
    const ac=new AbortController();
    assistantRequest<Page>(path,{signal:ac.signal}).then(p=>{
      if(ac.signal.aborted)return;
      setPlan(p.settings);setProjects([...p.selectedProjects,...p.projects]);setCursor(p.nextCursor);setError('');
      setProjectLimitExceeded(p.projectLimitExceeded);
    }).catch(e=>{if(!ac.signal.aborted)setError(assistantError(e));});
    return ()=>ac.abort();
  },[path,epoch]);
  async function save(){
    if(!plan || busy)return;
    const {version,enabled,stageEnabled,dailyTime,weeklyTime,weeklyDay,projectIds,stageKeys,audiences,inactivePolicy}=plan;
    const body=JSON.stringify({expectedVersion:version,enabled,stageEnabled,dailyTime,weeklyTime,weeklyDay,projectIds,stageKeys,audiences,inactivePolicy});
    if(attempt.current?.body!==body)attempt.current={body,key:crypto.randomUUID()};
    setBusy(true);
    try { const saved=await assistantRequest<Plan>(path,{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':attempt.current.key},body});
      setPlan(saved);attempt.current=null;setError('');reload(n=>n+1);notify.success('报告计划已保存');
    } catch(e){setError(assistantError(e));notify.error(assistantError(e));}finally{setBusy(false);}
  }
  async function more(){
    if(!cursor || busy)return;
    setBusy(true);
    try{const p=await assistantRequest<Page>(path+'&beforeId='+cursor);setProjects(prev=>[...prev,...p.projects]);setCursor(p.nextCursor);}
    catch(e){setError(assistantError(e));}finally{setBusy(false);}
  }
  const options=Array.from(new Map(projects.map(p=>[p.id,{value:p.id,label:p.name}])).values());
  const statusMessage=error || (projectLimitExceeded ? '当前报告计划超过 20 个工地，请缩小工地或阶段范围。' : '');
  return <><h2>报告计划</h2>{statusMessage && <Alert type="error" message={statusMessage} action={<Button onClick={()=>reload(n=>n+1)}>重新读取</Button>}/>}
    {plan && <Space direction="vertical" size="middle">
      <Space><Switch aria-label="启用报告计划" checked={plan.enabled} onChange={enabled=>setPlan({...plan,enabled})}/>启用报告计划</Space>
      <label>日报时间 <Input type="time" value={plan.dailyTime} onChange={e=>setPlan({...plan,dailyTime:e.target.value})}/></label>
      <Space>周报时间<Select aria-label="每周发送日" value={plan.weeklyDay} options={['一','二','三','四','五','六','日'].map((s,i)=>({value:i+1,label:'星期'+s}))}
        onChange={weeklyDay=>setPlan({...plan,weeklyDay})}/><Input type="time" aria-label="周报时间" value={plan.weeklyTime} onChange={e=>setPlan({...plan,weeklyTime:e.target.value})}/></Space>
      <label>工地（留空包含全部获权工地）<Select mode="multiple" style={{minWidth:240}} value={plan.projectIds} options={options}
        onChange={projectIds=>setPlan({...plan,projectIds})}/></label>{cursor && <Button onClick={more}>更多工地</Button>}
      <label>阶段（留空包含全部阶段）<Select mode="multiple" style={{minWidth:240}} value={plan.stageKeys}
        options={stageDefinitions.flatMap(s=>s.constructionKeys.map(k=>({value:k,label:s.name})))} onChange={stageKeys=>setPlan({...plan,stageKeys})}/></label>
      <Checkbox.Group options={roles} value={plan.audiences} onChange={audiences=>setPlan({...plan,audiences:audiences.map(String)})}/>
      <Button type="primary" loading={busy} onClick={save}>保存报告计划</Button>
    </Space>}</>;
}
