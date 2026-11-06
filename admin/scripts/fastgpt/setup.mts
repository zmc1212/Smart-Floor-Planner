/* eslint-disable @typescript-eslint/no-explicit-any -- Vendor setup payloads stay outside product input. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { reportWorkflow } from './workflow.mjs';
import { loginPilot } from './platform.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);require('@next/env').loadEnvConfig(process.cwd(),true);
const out=path.resolve('../tmp/fastgpt-report-pilot-20261106');fs.mkdirSync(out,{recursive:true});
const privateFile=path.join(out,'fastgpt.private.json');
let modelCredential='';
const state:any=fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):{baseUrl:'http://127.0.0.1:18300'};
const save=()=>{fs.writeFileSync(privateFile,JSON.stringify(state,null,2));execFileSync('icacls.exe',[privateFile,'/inheritance:r','/grant:r','Administrator:F','SYSTEM:F'],{windowsHide:true,stdio:'ignore'});};
const secretScript="$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-Content -LiteralPath D:/Smart-Floor-Planner-Dev/fastgpt-pilot/.env.fastgpt";
let secretText='';
try{secretText=execFileSync('ssh',['-i','C:/Users/Administrator/.ssh/toonflow_remote_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','Administrator@192.168.10.54',
  'powershell -NoProfile -EncodedCommand '+Buffer.from(secretScript,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});}
catch{throw Error('Pilot installation credential read unavailable; captured streams omitted');}
const secrets=Object.fromEntries(secretText.trim().split(/\r*\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
async function api(url:string,method='GET',body?:unknown){
 const res=await fetch(state.baseUrl+url,{method,headers:{'Content-Type':'application/json','fastgpt-web-request':'1',...(state.cookie?{Cookie:state.cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 const cookie=res.headers.get('set-cookie')?.match(/fastgpt_token=[^;]+/);if(cookie){state.cookie=cookie[0];save();}
 const packet:any=await res.json();if(!res.ok||packet.code&&packet.code!==200)throw Error(`${method} ${url}: HTTP${res.status} ${JSON.stringify(packet).slice(0,2400)}`);
 return packet.data===undefined?packet:packet.data;
}
try {
 if(process.env.FASTGPT_PILOT_ROOT_PASSWORD||!state.cookie){state.cookie=await loginPilot(state.baseUrl,process.env.FASTGPT_PILOT_ROOT_PASSWORD||secrets.ROOT_PASSWORD);save();}
 const {getPlatformLlmRuntimeConfig}=await import(pathToFileURL(path.resolve('src/lib/platform-llm-config.ts')).href);
 const source=await getPlatformLlmRuntimeConfig();if(!source.apiKey)throw Error('Existing model credential unavailable');modelCredential=source.apiKey;
 const model=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||source.model;
 if(!state.channelId){state.channelId=(await api('/api/core/ai/model/channel/create','POST',{channelType:'system',name:'小K已有模型·隔离联调',type:1,key:source.apiKey,base_url:source.baseUrl,models:[model],status:1,priority:1})).id;save();}
 if(!state.modelId){state.modelId=(await api('/api/core/ai/model/create','POST',{channelType:'system',channelIds:[state.channelId],modelData:{scope:'system',type:'llm',provider:'Other',model,name:'小K联调 · '+model,isActive:true,
   config:{maxContext:32768,maxResponse:4096,quoteMaxToken:16000,maxTemperature:1,toolChoice:true,vision:false,responseFormatList:['text','json_object'],defaultConfig:{enable_thinking:false}}}})).modelId;state.model=model;save();}
 await api('/api/core/ai/model/updateDefault','PUT',{llm:state.modelId,chatTitleLLMModelId:state.modelId});
 const workflow=reportWorkflow(state.modelId);fs.writeFileSync(path.join(out,'workflow.json'),JSON.stringify(workflow,null,2));
 const workflowHash=createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
 if(!state.appId){state.appId=await api('/api/core/app/create','POST',workflow);state.workflowHash=workflowHash;save();}
 if(state.workflowHash!==workflowHash){state.versionId=await api('/api/core/app/version/publish?appId='+state.appId,'POST',
   {nodes:workflow.nodes,edges:workflow.edges,chatConfig:workflow.chatConfig,isPublish:true,versionName:'隔离联调 '+workflowHash.slice(0,8)});state.workflowHash=workflowHash;save();}
 if(!state.apiKey){const value=await api('/api/support/openapi/create','POST',{name:'小K报告联调专用'});state.apiKey=typeof value==='string'?value:value.key||value.apiKey;save();if(!state.apiKey)throw Error('API credential response did not contain a key');}
 const catalog=await api('/api/core/ai/model/catalog');
 fs.writeFileSync(path.join(out,'platform.json'),JSON.stringify({baseUrl:state.baseUrl,appId:state.appId,modelId:state.modelId,model:state.model,channelId:state.channelId,modelCatalogVerified:!!catalog,providerKey:source.providerKey,providerBaseUrl:source.baseUrl,workflowNodes:workflow.nodes.map(n=>({id:n.nodeId,name:n.name})),sourceVersion:'v4.17.4'},null,2));
 console.log(JSON.stringify({configured:true,appId:state.appId,model:state.model,credentialValuesOmitted:true}));
}catch(error){let message=String(error);for(const value of [...Object.values(secrets),modelCredential,state.cookie,state.apiKey,process.env.FASTGPT_PILOT_ROOT_PASSWORD])if(value)message=message.replaceAll(String(value),'[redacted]');console.error(message);process.exitCode=1;}
finally{const {closePostgresPool}=await import(pathToFileURL(path.resolve('src/lib/postgresql.ts')).href);await closePostgresPool();}
