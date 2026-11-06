import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {knowledgeWorkflow,stageWorkflow} from './capabilities.mjs';
const root=path.resolve('..'),folder=path.join(root,'tmp/fastgpt-capabilities-20261106');fs.mkdirSync(folder,{recursive:true});
const original=JSON.parse(fs.readFileSync(path.join(root,'tmp/fastgpt-report-pilot-20261106/fastgpt.private.json'),'utf8'));
const privateFile=path.join(folder,'runtime.private.json');
const state=fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):{baseUrl:original.baseUrl,apiKey:original.apiKey,auditFile:path.join(folder,'workflow-attempts.jsonl')};
const save=()=>{fs.writeFileSync(privateFile,JSON.stringify(state,null,2));execFileSync('icacls.exe',[privateFile,'/inheritance:r','/grant:r','Administrator:F','SYSTEM:F'],{windowsHide:true,stdio:'ignore'});};
try{
 for(const [key,flow]of [['knowledgeAppId',knowledgeWorkflow()],['stageAppId',stageWorkflow(original.modelId)]]as const){
  fs.writeFileSync(path.join(folder,key+'.json'),JSON.stringify(flow,null,2));
  if(state[key])continue;
  const response=await fetch(state.baseUrl+'/api/core/app/create',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.apiKey},body:JSON.stringify(flow),signal:AbortSignal.timeout(20000)});
  const packet=await response.json();if(!response.ok||packet.code!==200||typeof packet.data!=='string')throw Error('Create private '+key+': HTTP'+response.status+' '+JSON.stringify(packet).slice(0,1800));
  state[key]=packet.data;save();
 }
 save();fs.writeFileSync(path.join(folder,'platform.json'),JSON.stringify({baseUrl:state.baseUrl,knowledgeAppId:state.knowledgeAppId,stageAppId:state.stageAppId,stageModel:original.model,knowledgeProvider:'existing original gateway; model bound by the original run',type:'advanced',independentSessions:false},null,2));
 console.log(JSON.stringify({configured:true,knowledgeAppId:state.knowledgeAppId,stageAppId:state.stageAppId,secretsOmitted:true}));
}catch(error){console.error(String(error).replaceAll(state.apiKey,'[redacted]'));process.exitCode=1;}
