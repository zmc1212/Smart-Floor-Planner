import test from 'node:test';
import assert from 'node:assert/strict';
import { readSipSdClock } from '../sd-clock';

const device='34020000001320000005',channel='34020000001320000006';
async function configured(work:()=>Promise<void>){const old={origin:process.env.CAMERA_SD_CLOCK_ORIGIN,token:process.env.CAMERA_SD_CLOCK_TOKEN};process.env.CAMERA_SD_CLOCK_ORIGIN='http://127.0.0.1:38183';process.env.CAMERA_SD_CLOCK_TOKEN='a'.repeat(43);try{await work();}finally{for(const [key,value]of Object.entries({CAMERA_SD_CLOCK_ORIGIN:old.origin,CAMERA_SD_CLOCK_TOKEN:old.token})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}}
const sample=()=>({source:new Date().toISOString(),serialHash:'b'.repeat(64),identityKind:'gb28181-registration',observedAt:new Date().toISOString()});
test('clock client keeps bearer private and validates fresh registration evidence',()=>configured(async()=>{
 let calls=0;
 const source=await readSipSdClock(device,channel,(async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,`/clock/${device}/${channel}`);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+'a'.repeat(43));assert.equal(init?.redirect,'error');return Response.json(sample());}) as typeof fetch);
 assert.equal(calls,1);assert.equal(source.serialHash,'b'.repeat(64));
}));
test('stale, future, wrong identity and oversized clock responses cannot calibrate',()=>configured(async()=>{
 for(const data of [{...sample(),observedAt:new Date(Date.now()-16000).toISOString()},{...sample(),observedAt:new Date(Date.now()+16000).toISOString()},{...sample(),identityKind:'unknown'},{...sample(),serialHash:'bad'},{...sample(),source:'invalid'}])await assert.rejects(readSipSdClock(device,channel,(async()=>Response.json(data)) as typeof fetch));
 await assert.rejects(readSipSdClock(device,channel,(async()=>new Response('x'.repeat(4097))) as typeof fetch));
}));
test('provider rejection and timeout are never replayed',()=>configured(async()=>{
 let calls=0;await assert.rejects(readSipSdClock(device,channel,(async()=>{calls++;return new Response('',{status:503});}) as typeof fetch));assert.equal(calls,1);
 calls=0;await assert.rejects(readSipSdClock(device,channel,(async()=>{calls++;throw new Error('timeout');}) as typeof fetch));assert.equal(calls,1);
}));
