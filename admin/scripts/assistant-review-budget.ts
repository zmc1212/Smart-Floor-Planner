import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

type Call={id?:string;runId?:string;status:string;usage?:{total_tokens:number};reservedTokens?:number};
export type RetainedReviewHold={id:string;runId:string;reservedTokens:number};
export type DevelopmentFeeAuthorization={plan:'xiaok-renovation-agent-development-plan';costLimit:null};
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
export function reviewBudget(root:string,authorization?:DevelopmentFeeAuthorization) {
  const scope=JSON.parse(fs.readFileSync(path.join(root,'scripts/agent-comparison/contract-scope.json'),'utf8'));
  assert.equal(scope.budgetPolicy,'cumulative_cost_and_fixed_cases');
  assert.equal(scope.newTokenLimit,null);assert.equal(scope.cumulativeTokens,null);
  assert.ok(Number.isSafeInteger(scope.cumulativeMicros)&&scope.cumulativeMicros>0&&scope.cumulativeMicros<=100000000,'Approved cumulative fee cap is CNY100');
  if(authorization)assert.ok(authorization.plan==='xiaok-renovation-agent-development-plan'&&authorization.costLimit===null,
    'Only the recorded XiaoK development-plan authorization removes the development fee ceiling');
  const costLimit=authorization?null:scope.cumulativeMicros;
  const read=(dir:string):Call[]=>fs.readdirSync(path.join(root,dir)).filter(f=>/^trial-.*\.json$/.test(f)).flatMap(f=>JSON.parse(fs.readFileSync(path.join(root,dir,f),'utf8')).calls||[]);
  const earlier=[...read('tmp/anythingllm-pilot'),...read('tmp/agent-comparison'),...read('tmp/agent-diagnosis')],later=read('tmp/agent-contract'),calls=[...earlier,...later];
  const newTokens=reviewTokens(calls),usedTokens=518485+newTokens,usedMicros=869762+newTokens*5;
  const unknownCount=calls.filter(c=>c.status!=='succeeded').length;
  return {scope,usedTokens,usedMicros,unknownCount,costLimit,
    legacyBatchTokens:Math.max(0,reviewTokens(later)-scope.batchStartsAfterContractTokens),
    assertReservation(consumedTokens:number,reservedTokens:number,explicitlyRetained:RetainedReviewHold[]=[]) {
      // Default remains blocked. A separately human-authorized batch can retain
      // exact detached holds; neither their outcomes nor their costs are reset.
      const identity=(c:{id?:string;runId?:string;reservedTokens?:number})=>JSON.stringify([c.id,c.runId,c.reservedTokens]);
      assert.equal(new Set(explicitlyRetained.map(identity)).size,explicitlyRetained.length,'Duplicate retained hold');
      assert.deepEqual(calls.filter(c=>c.status!=='succeeded').map(identity).sort(),explicitlyRetained.map(identity).sort(),
        'Unresolved provider outcome blocks dispatch unless the exact holds have explicit authorization');
      assert.ok(Number.isSafeInteger(consumedTokens)&&consumedTokens>=0&&Number.isSafeInteger(reservedTokens)&&reservedTokens>0,'Invalid token reservation');
      if(costLimit!==null)assert.ok(usedMicros+(consumedTokens+reservedTokens)*5<=costLimit,'Cumulative fee reservation exceeds the approved cap');
    },
  };
}
