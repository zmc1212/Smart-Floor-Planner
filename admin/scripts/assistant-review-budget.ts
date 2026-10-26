import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

type Call={status:string;usage?:{total_tokens:number};reservedTokens?:number};
export function reviewTokens(calls:Call[]) {
  return calls.reduce((n,c)=>{
    if(c.usage)assert.ok(Number.isSafeInteger(c.usage.total_tokens)&&c.usage.total_tokens>=0,'Invalid observed token accounting');
    if(c.status!=='succeeded')assert.ok(Number.isSafeInteger(c.reservedTokens)&&Number(c.reservedTokens)>0,'Unknown attempt requires its full reservation');
    const value=c.status==='succeeded' ? c.usage?.total_tokens??c.reservedTokens
      : Math.max(Number(c.reservedTokens),c.usage?.total_tokens??0);
    assert.ok(Number.isSafeInteger(value)&&Number(value)>=0,'Invalid historical/attempt token accounting');
    return n+Number(value);
  },0);
}
/** One canonical test ledger; old holds and all later fixed trials accumulate. */
export function reviewBudget(root:string) {
  const scope=JSON.parse(fs.readFileSync(path.join(root,'scripts/agent-comparison/contract-scope.json'),'utf8'));
  assert.equal(scope.budgetPolicy,'cumulative_cost_and_fixed_cases');
  assert.equal(scope.newTokenLimit,null);assert.equal(scope.cumulativeTokens,null);
  assert.ok(Number.isSafeInteger(scope.cumulativeMicros)&&scope.cumulativeMicros>0&&scope.cumulativeMicros<=100000000,'Approved cumulative fee cap is CNY100');
  const read=(dir:string):Call[]=>fs.readdirSync(path.join(root,dir)).filter(f=>/^trial-.*\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,dir,f),'utf8')).calls||[]);
  const earlier=[...read('tmp/anythingllm-pilot'),...read('tmp/agent-comparison'),...read('tmp/agent-diagnosis')],later=read('tmp/agent-contract'),calls=[...earlier,...later];
  const newTokens=reviewTokens(calls),usedTokens=518485+newTokens,usedMicros=869762+newTokens*5;
  const unknownCount=calls.filter(c=>c.status!=='succeeded').length;
  return {scope,usedTokens,usedMicros,unknownCount,
    legacyBatchTokens:Math.max(0,reviewTokens(later)-scope.batchStartsAfterContractTokens),
    assertReservation(consumedTokens:number,reservedTokens:number) {
      assert.equal(unknownCount,0,'Unresolved provider outcome blocks dispatch');
      assert.ok(Number.isSafeInteger(consumedTokens)&&consumedTokens>=0&&Number.isSafeInteger(reservedTokens)&&reservedTokens>0,'Invalid token reservation');
      assert.ok(usedMicros+(consumedTokens+reservedTokens)*5<=scope.cumulativeMicros,'Cumulative fee reservation exceeds the approved cap');
    },
  };
}
