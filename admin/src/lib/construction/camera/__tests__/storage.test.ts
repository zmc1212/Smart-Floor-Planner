import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateStorageSample,evaluateStorage,readStorageProbe} from '../storage';
const GiB=1024n**3n;
const sample=(available=900n)=>({version:1,node:'wvp-zlm-01',sampledAt:new Date().toISOString(),totalBytes:String(1000n*GiB),availableBytes:String(available*GiB),freeBytes:String(available*GiB),files:'100000',availableFiles:'90000'});
test('capacity boundaries, free-byte/inode floors and hysteresis protect without flapping',()=>{
  const check=(free:bigint,previous=false)=>evaluateStorage(validateStorageSample(sample(free),'wvp-zlm-01'),previous);
  assert.equal(check(201n).level,'ok');assert.equal(check(200n).level,'warning');assert.equal(check(100n).level,'critical');assert.equal(check(50n).level,'blocked');
  assert.equal(check(70n,true).blocked,true);assert.equal(check(101n,true).blocked,false);
  const small={...sample(),totalBytes:String(10n*GiB),freeBytes:String(4n*GiB),availableBytes:String(4n*GiB)};assert.equal(evaluateStorage(validateStorageSample(small,'wvp-zlm-01')).blocked,true);
  assert.equal(evaluateStorage(validateStorageSample({...sample(),availableFiles:'127'},'wvp-zlm-01')).blocked,true);
  assert.equal(evaluateStorage(validateStorageSample({...sample(),availableFiles:'511'},'wvp-zlm-01'),true).blocked,true);
  assert.equal(evaluateStorage(validateStorageSample({...sample(),files:'0',availableFiles:'0'},'wvp-zlm-01')).blocked,false);
});
test('capacity evidence rejects stale, foreign, impossible and lossy numeric samples',()=>{
  for(const patch of [{node:'foreign'},{sampledAt:new Date(Date.now()-61000).toISOString()},{sampledAt:new Date(Date.now()+61000).toISOString()},{totalBytes:'0'},{availableBytes:'-1'},{availableBytes:5},{availableBytes:String(1001n*GiB)},{availableFiles:'100001'},{totalBytes:'9223372036854775808'}])assert.throws(()=>validateStorageSample({...sample(),...patch},'wvp-zlm-01'),/storage_unavailable/);
});
test('private capacity transport pins endpoint, auth and bounded response; errors never become healthy',async()=>{
  const previous={origin:process.env.CAMERA_STORAGE_ORIGIN,token:process.env.CAMERA_STORAGE_TOKEN};process.env.CAMERA_STORAGE_ORIGIN='http://storage.test';process.env.CAMERA_STORAGE_TOKEN='synthetic-only-token-with-at-least-32-characters';
  try{
    const transport=(async(input:URL,init?:RequestInit)=>{assert.equal(String(input),'http://storage.test/storage');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+process.env.CAMERA_STORAGE_TOKEN);return Response.json(sample());}) as typeof fetch;
    assert.equal((await readStorageProbe(transport)).node,'wvp-zlm-01');
    await assert.rejects(readStorageProbe((async()=>new Response(null,{status:401})) as typeof fetch),/storage_unavailable/);
    await assert.rejects(readStorageProbe((async()=>new Response('x'.repeat(4097))) as typeof fetch),/storage_unavailable/);
    process.env.CAMERA_STORAGE_ORIGIN='http://user:secret@storage.test/';await assert.rejects(readStorageProbe(transport),/storage_unavailable/);
  }finally{for(const [key,value] of [['CAMERA_STORAGE_ORIGIN',previous.origin],['CAMERA_STORAGE_TOKEN',previous.token]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
});
