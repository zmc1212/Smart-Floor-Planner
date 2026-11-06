import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';

export async function loginPilot(baseUrl, password) {
  const headers={'Content-Type':'application/json','fastgpt-web-request':'1'};
  const pre=await fetch(baseUrl+'/api/support/user/account/preLogin?username=root',{headers,signal:AbortSignal.timeout(15000)});
  const challenge=await pre.json();
  if(!pre.ok||!challenge.data?.code)throw Error('FastGPT pilot pre-login unavailable');
  const response=await fetch(baseUrl+'/api/support/user/account/loginByPassword',{method:'POST',headers,
    body:JSON.stringify({username:'root',password:createHash('sha256').update(password).digest('hex'),code:challenge.data.code,language:'zh-CN'}),signal:AbortSignal.timeout(15000)});
  const cookie=response.headers.get('set-cookie')?.match(/fastgpt_token=[^;]+/)?.[0];
  if(!response.ok||!cookie){const packet=await response.json();throw Error('FastGPT pilot administrative login HTTP'+response.status+' code='+packet.code+' status='+String(packet.statusText).slice(0,80));}
  return cookie;
}

export async function workflowSnapshot(config) {
  if(!/^[a-f0-9]{24}$/.test(config.appId))throw Error('Invalid pilot app ID');
  // Bind the published version actually executed, rather than the editor draft.
  // Existing approved SSH/container database credentials are used read-only;
  // the user's administrative password and browser session are never changed.
  const nodeCount=config.nodeCount??5;
  if(!Number.isSafeInteger(nodeCount)||nodeCount<3||nodeCount>20)throw Error('Invalid pilot node count');
  const probe=`const fs=require('fs'),crypto=require('crypto');const p=fs.readdirSync('/app/node_modules/.pnpm').find(x=>x.startsWith('mongoose@'));const m=require('/app/node_modules/.pnpm/'+p+'/node_modules/mongoose');(async()=>{const c=await m.createConnection(process.env.MONGODB_URI).asPromise();try{const id=new m.Types.ObjectId('${config.appId}');const a=await c.db.collection('apps').findOne({_id:id});if(!a)throw Error('Pilot app missing');const v=a.publishedVersionId?await c.db.collection('app_versions').findOne({_id:a.publishedVersionId,appId:id}):await c.db.collection('app_versions').find({appId:id,isPublish:true}).sort({time:-1,_id:-1}).limit(1).next();if(v?.nodes?.length!==${nodeCount})throw Error('Published pilot workflow missing');const h=x=>crypto.createHash('sha256').update(x).digest('hex');console.log(JSON.stringify({versionId:String(v._id),workflow:h(JSON.stringify({nodes:v.nodes,edges:v.edges,chatConfig:v.chatConfig,resources:v.resources})),preload:h(fs.readFileSync('/app/pilot/disable-openai-retries.cjs')),configuration:h(fs.readFileSync('/app/data/config.json'))}));}finally{await c.close();}})().catch(()=>{console.error('Published pilot snapshot unavailable');process.exitCode=1;});`;
  const script='$ProgressPreference="SilentlyContinue"; $probe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("'+Buffer.from(probe).toString('base64')+'")); $probe | docker exec -i sfp-fastgpt-pilot-app-1 node; exit $LASTEXITCODE';
  const args=['-i','C:/Users/Administrator/.ssh/toonflow_remote_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','Administrator@192.168.10.54','powershell -NoProfile -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')];
  const raw=await new Promise((resolve,reject)=>execFile('ssh',args,{encoding:'utf8',windowsHide:true,timeout:20000},(error,stdout)=>error?reject(Error('Published pilot SSH snapshot unavailable')):resolve(stdout)));
  const published=JSON.parse(raw.trim());
  const models=await fetch(config.baseUrl+'/api/core/ai/model/catalog',{headers:{Authorization:'Bearer '+config.apiKey,'fastgpt-web-request':'1'},signal:AbortSignal.timeout(15000)});
  if(!models.ok)throw Error('FastGPT model metadata HTTP'+models.status);
  const catalog=(await models.json()).data;
  return createHash('sha256').update(JSON.stringify({published,catalog})).digest('hex');
}
