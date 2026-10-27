import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyPartialEvidence } from '../assistant-partial-evidence';
import { bailianBinding } from '@/lib/ai/providers/bailian-capabilities';
import { partialBody } from '@/lib/assistant/agent/draft-continuation';
import { parseAgentChat } from '@/lib/ai/providers/agent-chat';
import { fingerprint } from '@/lib/assistant/contracts';

test('Partial proof requires actual bound wire shape, recent source/parser match and a safe suffix',()=>{
  const root=path.resolve(process.cwd(),'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfp-partial-proof-'));
  const binding=bailianBinding('https://dashscope.aliyuncs.com/compatible-mode','qwen3.8-flash',false)!;
  const sources=['admin/src/lib/assistant/agent/draft-continuation.ts','admin/src/lib/assistant/contracts/model.ts','admin/src/lib/ai/providers/agent-chat.ts'];
  const prefix='量房提醒：',request=partialBody(binding,prefix);
  const response={id:'synthetic-proof',choices:[{message:{content:'先核对门口高差。'},finish_reason:'stop'}],usage:{prompt_tokens:80,completion_tokens:12}};
  const result=parseAgentChat(response,'synthetic-proof');
  const wire={status:200,method:'POST',url:binding.baseUrl+'/chat/completions',body:request,response,requestId:'synthetic-proof',startedAt:new Date().toISOString()};
  const wireFile=path.join(dir,'wire.json'),file=path.join(dir,'proof.json');
  const proof={protocol:'bailian-partial-live-v1',binding,prefix,request,requestHash:fingerprint(request),result,responseHash:fingerprint(result),wireFile,
    sourceHashes:Object.fromEntries(sources.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))};
  const write=()=>{fs.writeFileSync(wireFile,JSON.stringify(wire));fs.writeFileSync(file,JSON.stringify(proof));};
  try {
    write();assert.equal(verifyPartialEvidence(root,file,binding),true);
    assert.equal(verifyPartialEvidence(root,file,{...binding,thinking:true}),false);
    wire.status=400;write();assert.equal(verifyPartialEvidence(root,file,binding),false);wire.status=200;
    wire.body.messages[1].partial=false as true;write();assert.equal(verifyPartialEvidence(root,file,binding),false);wire.body=partialBody(binding,prefix);
    wire.response.choices[0].message.content='已保存需求';write();assert.equal(verifyPartialEvidence(root,file,binding),false);
    wire.response.choices[0].message.content='先核对门口高差。';proof.sourceHashes[sources[0]]='changed';write();assert.equal(verifyPartialEvidence(root,file,binding),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
