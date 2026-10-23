// Real device acceptance in the isolated camera fixture. Small reversible pulses.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const dir=path.resolve('../tmp/cloud-camera'),f=JSON.parse(fs.readFileSync(path.join(dir,'fixture.private.json'),'utf8'));
const base='http://localhost:3018/api/miniprogram/construction/video/projects/'+f.projectId,origin='http://localhost:3017';
let cookie='',csrf='';
async function staff(route,data){const r=await fetch(base+'/'+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+f.miniToken,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b.data;}
async function api(route,data){const r=await fetch(origin+'/api/construction-camera/'+route,{method:data?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'x-camera-csrf':csrf,'Content-Type':'application/json','idempotency-key':randomUUID()},...(data?{body:JSON.stringify(data)}:{})});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b.data;}
async function shot(name){const s=await api('snapshots',{bindingId:f.bindingId});assert.equal(s.state,'ready');const r=await fetch(origin+'/api/construction-camera/snapshots/'+s.id,{headers:{Cookie:cookie}});assert.equal(r.status,200);fs.writeFileSync(path.join(dir,name+'.jpg'),Buffer.from(await r.arrayBuffer()));return s.id;}
const report={started:new Date().toISOString(),checks:[]};
if(process.argv.includes('--entry')){fs.writeFileSync(path.join(dir,'browser-entry.private.json'),JSON.stringify(await staff('entry',{})));console.log('Fresh private entry ready');process.exit(0);}
try{
 const camera=(await staff('cameras')).items.find(c=>String(c.id)===f.cameraId);assert.ok(camera);
 await staff('configure',{cameraId:f.cameraId,expectedVersion:camera.version,ptzEnabled:true});
 const entry=await staff('entry',{}),r=await fetch(origin+'/api/construction-camera/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({entry:entry.url.split('#entry=')[1]})}),b=await r.json();assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=b.data.csrf;
 report.before=await shot('ptz-before');
 for(const command of ['left','right']){report.checks.push({command,...await api('ptz',{bindingId:f.bindingId,command,sequence:Date.now()})});await new Promise(r=>setTimeout(r,3500));report[command]=await shot('ptz-'+command);}
 report.stopped=await api('ptz',{bindingId:f.bindingId,command:'stop',sequence:Date.now()});report.passed=true;
 fs.writeFileSync(path.join(dir,'browser-entry.private.json'),JSON.stringify(await staff('entry',{})));
 console.log(JSON.stringify({passed:true,commands:report.checks,stop:report.stopped}));
}catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{if(csrf)await api('ptz',{bindingId:f.bindingId,command:'stop',sequence:Date.now()}).catch(()=>{});fs.writeFileSync(path.join(dir,'ptz-real.json'),JSON.stringify(report,null,2));}
