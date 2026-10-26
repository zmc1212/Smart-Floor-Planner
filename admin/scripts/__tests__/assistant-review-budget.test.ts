import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewBudget, reviewTokens } from '../assistant-review-budget';

function fixture(calls:unknown[]=[]) {
  const parent=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'assistant-review-budget-'));
  for(const p of ['scripts/agent-comparison','tmp/anythingllm-pilot','tmp/agent-comparison','tmp/agent-diagnosis','tmp/agent-contract'])fs.mkdirSync(path.join(root,p),{recursive:true});
  fs.writeFileSync(path.join(root,'scripts/agent-comparison/contract-scope.json'),JSON.stringify({budgetPolicy:'cumulative_cost_and_fixed_cases',newTokenLimit:null,cumulativeTokens:null,cumulativeMicros:100000000,batchStartsAfterContractTokens:262470}));
  fs.writeFileSync(path.join(root,'tmp/agent-contract/trial-fixture.json'),JSON.stringify({calls}));
  return {root,close(){assert.equal(path.dirname(path.resolve(root)),parent);assert.ok(path.basename(root).startsWith('assistant-review-budget-'));fs.rmSync(root,{recursive:true,force:true});}};
}
test('historical consumption and original unknown cash hold remain in the total',()=>{
  const f=fixture([{status:'succeeded',usage:{total_tokens:10000}}]);try{const b=reviewBudget(f.root);assert.equal(b.usedTokens,528485);assert.equal(b.usedMicros,919762);b.assertReservation(1000,2000);}finally{f.close();}
});
test('token caps are removed but cumulative fee still blocks a reservation',()=>{
  const f=fixture();try{const b=reviewBudget(f.root);b.assertReservation(1500000,1000);assert.throws(()=>b.assertReservation(20000000,1),/fee reservation/);}finally{f.close();}
});
test('new unknown uses its reserve and prevents another dispatch',()=>{
  const f=fixture([{status:'unknown',usage:{total_tokens:100},reservedTokens:1200}]);try{const b=reviewBudget(f.root);assert.equal(b.usedMicros,875762);assert.throws(()=>b.assertReservation(0,1),/Unresolved provider/);}finally{f.close();}
});
test('last affordable whole-token reservation is allowed and the next is rejected',()=>{
  const f=fixture();try{const b=reviewBudget(f.root),remaining=Math.floor((100000000-b.usedMicros)/5);b.assertReservation(0,remaining);assert.throws(()=>b.assertReservation(0,remaining+1),/fee reservation/);}finally{f.close();}
});
test('invalid usage and invalid reservations never become zero cost',()=>{
  assert.throws(()=>reviewTokens([{status:'succeeded',usage:{total_tokens:-1}}]),/Invalid/);
  assert.throws(()=>reviewTokens([{status:'unknown'}]),/reservation/);
  assert.equal(reviewTokens([{status:'unknown',usage:{total_tokens:1400},reservedTokens:1200}]),1400);
  const f=fixture();try{const b=reviewBudget(f.root);for(const v of [-1,0,0.1,NaN])assert.throws(()=>b.assertReservation(0,v),/Invalid/);}finally{f.close();}
});
