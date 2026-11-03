import assert from 'node:assert/strict';
import {test} from 'node:test';
import {retrySoakRead,transientSoakDatabaseError,assertSoakStorageMounts,type SoakReadFailure} from './construction-camera-soak-recovery';

test('capacity preflight rejects a restored Docker volume and accepts only the approved matching overlays',()=>{
 const source='/run/desktop/mnt/host/f/SmartFloorPlannerCamera/media/record',approved='F:/SmartFloorPlannerCamera/media/record';
 const probe={name:'/sfp-camera-storage-storage-1',mounts:[{Type:'bind',Destination:'/media/record',Source:source,RW:false}]};
 assert.throws(()=>assertSoakStorageMounts([{name:'/wvp-stack-zlm-1',mounts:[{Type:'volume',Destination:'/opt/media/www',Source:'/volume',RW:true}]},probe],approved));
 const recorder={name:'/wvp-stack-zlm-1',mounts:[{Type:'bind',Destination:'/opt/media/www/record',Source:source,RW:true}]};
 assert.doesNotThrow(()=>assertSoakStorageMounts([recorder,probe],approved));
 assert.throws(()=>assertSoakStorageMounts([recorder,{...probe,mounts:[{...probe.mounts[0],Source:source.replace('/host/f/','/host/g/')}]}],approved));
 assert.throws(()=>assertSoakStorageMounts([{...recorder,mounts:[{...recorder.mounts[0],RW:false}]},probe],approved));
});

test('only known PostgreSQL connection failures qualify, including a wrapped cause',()=>{
 assert.ok(transientSoakDatabaseError(new Error('Connection terminated due to connection timeout')));
 assert.ok(transientSoakDatabaseError(new Error('query failed',{cause:Object.assign(new Error('reset'),{code:'ECONNRESET'})})));
 for(const e of [new Error('camera_forbidden'),Object.assign(new Error('constraint'),{code:'23505'}),new Error('query timeout'),new Error('camera_service_unavailable')])assert.equal(transientSoakDatabaseError(e),false);
});
test('a transient read recovers without replacing its first failure receipt',async()=>{
 const failures:SoakReadFailure[]=[];let calls=0;const result=await retrySoakRead('policy',async()=>{if(++calls===1)throw Object.assign(new Error('reset'),{code:'ECONNRESET'});return {enabled:false};},failures,async()=>{});
 assert.deepEqual(result,{enabled:false});assert.equal(calls,2);assert.equal(failures.length,1);assert.equal(failures[0].phase,'policy');
});
test('permission failures never retry and connection failures stop after three attempts',async()=>{
 for(const [error,expected] of [[new Error('camera_forbidden'),1],[Object.assign(new Error('reset'),{code:'ECONNRESET'}),3]] as const){
  let calls=0;const failures:SoakReadFailure[]=[];await assert.rejects(retrySoakRead('history',async()=>{calls++;throw error;},failures,async()=>{}),e=>e===error);assert.equal(calls,expected);assert.equal(failures.length,expected);
 }
});
