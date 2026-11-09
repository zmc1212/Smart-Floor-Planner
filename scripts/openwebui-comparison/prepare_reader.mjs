// Prepare a reproducible, disposable reader runtime. This does not start services,
// install dependencies, configure a model, seed data, or modify XiaoK.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const source=import.meta.dirname,root=path.resolve(source,'../..');
const runtime=path.join(root,'tmp/xiaok-intelligent-consult/mature-reader-runtime');
const vendor=path.join(runtime,'crawl4ai-upstream');fs.mkdirSync(vendor,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(source,'upstream.manifest.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const copied=[];
for(const file of manifest.files){
 assert.ok(file.url.startsWith('https://raw.githubusercontent.com/unclecode/crawl4ai/v0.9.2/'));
 assert.equal(path.basename(file.path),file.path);
 const target=path.join(vendor,file.path);
 if(fs.existsSync(target))assert.equal(hash(fs.readFileSync(target)),file.sha256);
 else{
  const response=await fetch(file.url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),file.sha256);
  fs.writeFileSync(target,bytes,{flag:'wx'});
 }
 copied.push({file:file.path,sha256:file.sha256});
}
const reader=fs.readFileSync(path.join(source,'crawl4ai_reader.py'));
const proxyServer=fs.readFileSync(path.join(source,'egress_proxy_server.py'));
const proxyTarget=path.join(vendor,'serve.py');
if(fs.existsSync(proxyTarget))assert.equal(hash(fs.readFileSync(proxyTarget)),hash(proxyServer));
else fs.writeFileSync(proxyTarget,proxyServer,{flag:'wx'});
const target=path.join(runtime,'openwebui-mature-reader.py');
if(fs.existsSync(target))assert.equal(hash(fs.readFileSync(target)),hash(reader));
else fs.writeFileSync(target,reader,{flag:'wx'});
console.log(JSON.stringify({prepared:true,scope:manifest.scope,runtime,
 readerSha256:hash(reader),upstream:copied,requirements:path.join(source,'requirements.txt'),
 note:'Use the isolated Python environment and the approved SSH/Docker proxy configuration. This command performs zero model calls.'},null,2));
