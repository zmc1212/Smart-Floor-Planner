import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { lockAssistantAcceptance } from '../assistant-acceptance-safety.mjs';

const target='postgresql://synthetic@localhost:55432/xiaok_embedding_eval';
async function fakeClient(respond, work) {
  const Original=pg.Client,calls=[];let ended=0;
  pg.Client=class {
    async connect() { calls.push('connect'); }
    async query(sql) { calls.push(sql);return {rows:await respond(sql)}; }
    async end() { ended++; }
  };
  try { await work(calls,()=>ended); } finally { pg.Client=Original; }
}

test('waiting never connects to an unapproved database, port or host',async()=>{
  await fakeClient(()=>{throw Error('Unexpected connection');},async calls=>{
    for(const waitForLock of [false,true])for(const url of ['postgresql://synthetic@localhost:5432/smart_floor_planner',
      'postgresql://synthetic@localhost:55432/other','postgresql://synthetic@example.invalid:55432/xiaok_embedding_eval']){
      await assert.rejects(lockAssistantAcceptance(url,{waitForLock}),/Acceptance requires isolated loopback/);
    }
    assert.deepEqual(calls,[]);
  });
});

test('default contention remains fail-fast and closes the lock session',async()=>{
  await fakeClient(sql=>sql.includes('pg_roles')?[{rolsuper:false,rolbypassrls:false}]:[{acquired:false}],async(calls,ended)=>{
    await assert.rejects(lockAssistantAcceptance(target),/Another assistant acceptance run/);
    assert.ok(calls.some(s=>s.includes('pg_try_advisory_lock')));
    assert.ok(calls.every(s=>!s.includes('select pg_advisory_lock(')));assert.equal(ended(),1);
  });
});

test('a queued caller rechecks its role, migration and idle queue before retaining the same exclusive lock',async()=>{
  await fakeClient(sql=>sql.includes('pg_roles')?[{rolsuper:false,rolbypassrls:false}]:sql.includes('to_regclass')?[{present:true}]
    :sql.includes('assistant_jobs')?[{active:0}]:[],async(calls,ended)=>{
    const release=await lockAssistantAcceptance(target,{waitForLock:true});
    const acquired=calls.findIndex(s=>s.includes('select pg_advisory_lock('));assert.ok(acquired>0);
    assert.equal(calls.filter(s=>s.includes('pg_roles')).length,2);
    assert.ok(calls.findIndex(s=>s.includes('to_regclass'))>acquired);
    assert.ok(calls.findIndex(s=>s.includes('assistant_jobs'))>acquired);
    assert.ok(calls.some(s=>s.includes("'lock_timeout','15min'")));assert.ok(calls.includes('rollback'));
    assert.equal(ended(),0);await release();assert.equal(ended(),1);
  });
});

test('role changes or active jobs after waiting fail closed and release the session',async()=>{
  for(const failure of ['role','queue']){
    let roleReads=0;
    await fakeClient(sql=>sql.includes('pg_roles')?[{rolsuper:false,rolbypassrls:failure==='role'&&++roleReads===2}]
      :sql.includes('to_regclass')?[{present:true}]:sql.includes('assistant_jobs')?[{active:1}]:[],async(calls,ended)=>{
      await assert.rejects(lockAssistantAcceptance(target,{waitForLock:true}),failure==='role'?/non-BYPASSRLS/:/idle isolated queue/);
      assert.equal(ended(),1);
      if(failure==='role')assert.ok(calls.every(s=>!s.includes('assistant_jobs')));else assert.ok(calls.includes('rollback'));
    });
  }
});
