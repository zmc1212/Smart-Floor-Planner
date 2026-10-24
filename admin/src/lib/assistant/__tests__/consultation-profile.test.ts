import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultationBinding, consultationDispatchBudget, consultationCostUpperMicros, consultationScenarioPreflight,
  type FreeConsultationBinding, type MeteredConsultationBinding } from '../agent/consultation-profile';
import { consultationAcceptanceProfile as profile, consultationLongProfile, consultationCashAuthorization,
  consultationTariffVersion, consultationUnknownIsolation as isolation } from '@/lib/assistant/contracts/consultation';
import { matchesConsultationIsolation } from '../agent/consultation-isolation';
import { agentConfig, agentCapabilityFingerprint } from '../agent/config';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';
import { agentRequestBudget } from '../agent/context-budget';
const now = Date.parse('2026-10-23T12:00:00.000Z');
const binding: FreeConsultationBinding = { profile: profile.id, stage: 'R1', budgetGroup: 'consult-r1-fixed',
  quota: { model: profile.model, remainingTokens: 436365, quotaOnly: true,
    verifiedAt: new Date(now).toISOString(), observedTokensAtVerification: 0 } };
const request = { binding, now, createdAt: new Date(now).toISOString(), estimatedRequestTokens: 10000,
  observedTokens: 45000, heldTokens: 5000, unknownUsage: false, calls: 2, summaries: 0, perceptions: 0, purpose: 'answer' as const };
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === expected);

test('the same original ledger cannot exceed the exact60000 observed-plus-held cap', () => {
  assert.equal(consultationDispatchBudget(request).remainingTokens, 0);
  assert.throws(() => consultationDispatchBudget({ ...request, estimatedRequestTokens: 10001 }), code('assistant_quota_exceeded'));
});
test('unknown usage retains its hold and stops further dispatch even when free quota remains', () => {
  assert.throws(() => consultationDispatchBudget({ ...request, unknownUsage: true }), code('provider_outcome_unknown'));
});
test('reviewed totals supplement observed usage and cannot reset the original token cap', () => {
  assert.equal(consultationDispatchBudget({ ...request, accountedTokens: 45000 }).totalTokens,60000);
  assert.throws(() => consultationDispatchBudget({ ...request, accountedTokens: 45001 }),code('assistant_quota_exceeded'));
  for (const accountedTokens of [44999,-1,NaN,Number.MAX_SAFE_INTEGER+1])
    assert.throws(() => consultationDispatchBudget({ ...request, accountedTokens }),code('assistant_quota_exceeded'));
});
test('a refreshed quota subtracts only usage since verification and never restores the stage budget', () => {
  const refreshed: FreeConsultationBinding = { ...binding, quota: { ...binding.quota, remainingTokens: 1000, observedTokensAtVerification: 10000 } };
  const input = { ...request, binding: refreshed, heldTokens: 0, observedTokens: 10000, estimatedRequestTokens: 1000 };
  assert.equal(consultationDispatchBudget(input).remainingTokens, 0);
  assert.throws(() => consultationDispatchBudget({ ...input, observedTokens: 10001 }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...input, observedTokens: 9999 }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...request, binding: { ...binding, quota: { ...binding.quota,
    observedTokensAtVerification: 45000 } }, estimatedRequestTokens: 10001 }), code('assistant_quota_exceeded'));
});
test('summary, perception and main calls share one count and the same180-second deadline', () => {
  assert.throws(() => consultationDispatchBudget({ ...request, calls: 6 }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...request, purpose: 'summary', summaries: 1 }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...request, purpose: 'vision', perceptions: 1 }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...request, now: now + 180000 }), code('agent_deadline_exceeded'));
  assert.equal(consultationDispatchBudget({ ...request, now: now + 179999 }).remainingMs, 1);
});
test('missing quota-only, another model, extra authority fields and stale/future records are rejected', () => {
  assert.deepEqual(consultationBinding(binding), binding);
  for (const quota of [{ ...binding.quota, quotaOnly: false }, { ...binding.quota, model: 'another-model' }])
    assert.equal(consultationBinding({ ...binding, quota }), null);
  assert.equal(consultationBinding({ ...binding, tenantId: 'other-tenant' }), null);
  assert.throws(() => consultationDispatchBudget({ ...request, binding: { ...binding,
    quota: { ...binding.quota, verifiedAt: new Date(now - 16 * 60000).toISOString() } } }), code('assistant_quota_exceeded'));
  assert.throws(() => consultationDispatchBudget({ ...request, binding: { ...binding,
    quota: { ...binding.quota, verifiedAt: new Date(now + 1).toISOString() } } }), code('assistant_quota_exceeded'));
});

test('the server profile is bound to the verified endpoint/model/thinking and never leaks quota authority onto the wire', () => {
  const input = { model: profile.model, profile: profile.id, maxTokens: 8192, enableThinking: false, messages: [], tools: [], deadlineAt: now + 180000 };
  const body = agentChatBody(input, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(body.max_tokens, 8192); assert.equal(body.enable_thinking, false);
  assert.equal('profile' in body, false); assert.equal('deadlineAt' in body, false);
  for (const override of [{ model: 'another' }, { enableThinking: true }, { maxTokens: 8193 }])
    assert.throws(() => agentChatBody({ ...input, ...override }, 'https://dashscope.aliyuncs.com/compatible-mode/v1'));
  for (const endpoint of ['https://api.deepseek.com/v1', 'https://dashscope.aliyuncs.com/another'])
    assert.throws(() => agentChatBody(input, endpoint));
  assert.equal(agentRequestBudget().maxOutputTokens, 2048);
  assert.equal(agentRequestBudget({ profile: profile.id, purpose: 'summary' }).maxOutputTokens, 2048);
  assert.throws(() => agentChatBody({ ...input, profile: undefined }, 'https://dashscope.aliyuncs.com/compatible-mode/v1'));
});

test('profile rollout keeps a bound run while changes to actual capabilities still fence it', () => {
  const legacy = agentConfig({ runtime: 'langgraph-v1', providerKey: 'bailian', model: profile.model,
    imageInput: false, tools: true, probeVersion: 'verified-flash' })!;
  const optIn = agentConfig({ ...legacy, consultation: binding })!;
  assert.deepEqual(optIn.consultation, binding);
  assert.equal(agentCapabilityFingerprint(legacy), agentCapabilityFingerprint(optIn));
  assert.notEqual(agentCapabilityFingerprint(optIn), agentCapabilityFingerprint({ ...optIn, probeVersion: 'changed-probe' }));
  assert.throws(() => agentConfig({ ...optIn, model: 'another-model' }), code('assistant_capability_forbidden'));
});

const metered: MeteredConsultationBinding = { stage:'R1',budgetGroup:binding.budgetGroup,profile:consultationLongProfile.id,
  metered:{authorization:consultationCashAuthorization,cashLimitMicros:5000000,tariff:consultationTariffVersion} };
test('long trials require the exact paid authorization, while free trials still require quota-only',()=>{
  assert.deepEqual(consultationBinding(metered),metered);
  for(const override of [{cashLimitMicros:5000001},{authorization:'another'},{tariff:'unknown'}])
    assert.equal(consultationBinding({...metered,metered:{...metered.metered,...override}}),null);
  assert.equal(consultationBinding({...metered,quota:binding.quota}),null);
  assert.equal(consultationBinding({...binding,profile:consultationLongProfile.id}),null);
  const input={profile:metered.profile,model:consultationLongProfile.model,maxTokens:8192,enableThinking:false,messages:[],tools:[]};
  const body=agentChatBody(input,'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(body.model,'qwen3.7-flash');assert.equal(body.enable_thinking,false);
  assert.equal('metered' in body,false);assert.equal('profile' in body,false);
  assert.throws(()=>agentChatBody({...input,model:profile.model},'https://dashscope.aliyuncs.com/compatible-mode/v1'));
  const config=agentConfig({runtime:'langgraph-v1',providerKey:'bailian',model:consultationLongProfile.model,imageInput:false,tools:true,probeVersion:'qwen-long',consultation:metered});
  assert.equal(config?.consultation?.profile,metered.profile);
  assert.notEqual(agentCapabilityFingerprint(config),agentCapabilityFingerprint({...config!,model:profile.model}));
});
test('Qwen cash holds use exact integer upper bounds and cannot reset the campaign token cap',()=>{
  assert.equal(consultationCostUpperMicros(1,1),6);
  assert.equal(consultationCostUpperMicros(1000000,1000000),6000000);
  const paid={...request,binding:metered,knownCostMicros:4952000,heldCostMicros:0};
  assert.equal(consultationDispatchBudget(paid).costUpperMicros,5000000);
  assert.throws(()=>consultationDispatchBudget({...paid,heldCostMicros:1}),code('assistant_quota_exceeded'));
  assert.throws(()=>consultationDispatchBudget({...paid,knownCostMicros:undefined}),code('provider_usage_unknown'));
  assert.throws(()=>consultationDispatchBudget({...paid,unknownUsage:true}),code('provider_outcome_unknown'));
  assert.throws(()=>consultationDispatchBudget({...paid,observedTokens:990000,heldTokens:0,estimatedRequestTokens:10001,knownCostMicros:0}),code('assistant_quota_exceeded'));
});
test('whole-scenario preflight retains each funding ledger and refuses before starting an unfunded chain',()=>{
  const input={binding:metered,now,observedTokens:14552,heldTokens:0,unknownUsage:false,knownCostMicros:0,heldCostMicros:0};
  const result=consultationScenarioPreflight({...input,requestReservations:[10000,10000,10000,10000]});
  assert.equal(result.totalTokens,54552);assert.equal(result.plannedCalls,4);assert.equal(result.actualBilledMicros,null);
  assert.equal(result.model,'qwen3.7-flash');
  // The approved funding change keeps the old free failure and its spending;
  // a new Qwen trial uses its separately approved campaign, without fallback.
  assert.throws(()=>consultationScenarioPreflight({...input,binding,requestReservations:[46785]}),code('assistant_quota_exceeded'));
  assert.equal(consultationScenarioPreflight({...input,observedTokens:0,requestReservations:[46785]}).remainingTokens,953215);
  assert.throws(()=>consultationScenarioPreflight({...input,observedTokens:950001,requestReservations:[10000,10000,10000,10000,10000]}),code('assistant_quota_exceeded'));
  assert.throws(()=>consultationScenarioPreflight({...input,requestReservations:[]}),code('assistant_quota_exceeded'));
});

const isolated: MeteredConsultationBinding = { ...metered, metered: { ...metered.metered,
  isolatedUnknownAuthorization: isolation.authorization, scenarioTokenLimit: 300000 } };
const retained = { ...request, binding: isolated, observedTokens: 314444, accountedTokens: 314444,
  heldTokens: 59497, unknownUsage: true, knownCostMicros: 396702, heldCostMicros: 285586,
  isolatedUnknownAuthorization: isolation.authorization, scenarioAccountedTokens: 0, scenarioHeldTokens: 0 };

test('only the named server opt-in plus exact retained ledger proof may isolate the old unknown',()=>{
  assert.deepEqual(consultationBinding(isolated),isolated);
  for(const patch of [{isolatedUnknownAuthorization:'another'}, {scenarioTokenLimit:59999},
    {scenarioTokenLimit:1000001}, {scenarioTokenLimit:NaN}, {allowUnknown:true}])
    assert.equal(consultationBinding({...isolated,metered:{...isolated.metered,...patch}}),null);
  assert.equal(consultationDispatchBudget(retained).totalTokens,383941);
  for(const patch of [{isolatedUnknownAuthorization:undefined}, {binding:metered}, {binding},
    {heldTokens:59496}, {heldCostMicros:285585}])
    assert.throws(()=>consultationDispatchBudget({...retained,...patch}),code('provider_outcome_unknown'));
});

test('a second unknown or any changed original identity/reservation cannot obtain isolation proof',()=>{
  const original: Record<string,unknown> = {run_id:'9216',attempt_id:'2369',run_status:'indeterminate',run_error:'provider_outcome_unknown',
    attempt_status:'failed',attempt_error:'PROVIDER_CONNECTION_FAILED',request_fingerprint:isolation.requestFingerprint,
    remote_task_id:null,remote_status:null,reservation_status:'reconciling',version:11,reserved_tokens:'89596',reserved_cost_micros:'323790',
    observed_tokens:'30099',known_cost_micros:'38204',settled_tokens:'30099',settled_cost_micros:null,attempt_count:5,usage_count:4,review_count:0};
  assert.equal(matchesConsultationIsolation('4536',['9216'],original),true);
  assert.equal(matchesConsultationIsolation('4537',['9216'],original),false);
  for(const ids of [null,[],['9999'],['9216','9999']])assert.equal(matchesConsultationIsolation('4536',ids,original),false);
  for(const patch of [{run_id:'9999'}, {attempt_id:'2370'}, {request_fingerprint:'changed'}, {version:12}, {reserved_tokens:'89595'},
    {reserved_cost_micros:'323789'}, {observed_tokens:'30100'}, {known_cost_micros:'38205'}, {remote_task_id:'receipt'},
    {attempt_count:6}, {usage_count:5}, {review_count:1}, {settled_cost_micros:'0'}, {reservation_status:'settled'}])
    assert.equal(matchesConsultationIsolation('4536',['9216'],{...original,...patch}),false,JSON.stringify(patch));
});

test('two fresh scenario envelopes fund all registered slots without giving either chain the other allocation',()=>{
  const first=consultationScenarioPreflight({...retained,requestReservations:Array(10).fill(60000)});
  assert.equal(first.plannedCalls,10);assert.equal(first.requestCeilingTokens,600000);
  assert.equal(first.fundedTokenEnvelope,300000);assert.equal(first.allocationMode,'hard-scenario-envelope');
  const second=consultationScenarioPreflight({...retained,heldTokens:retained.heldTokens+first.fundedTokenEnvelope,
    heldCostMicros:retained.heldCostMicros+first.reservedCostMicros,requestReservations:Array(10).fill(60000)});
  assert.equal(second.totalTokens,973941);assert.equal(second.costUpperMicros,3562288);
  assert.equal(consultationDispatchBudget({...retained,scenarioAccountedTokens:240000,estimatedRequestTokens:60000}).totalTokens,433941);
  for(const patch of [{scenarioAccountedTokens:240001,estimatedRequestTokens:60000}, {scenarioHeldTokens:290001},
    {scenarioAccountedTokens:undefined}, {scenarioHeldTokens:undefined}])
    assert.throws(()=>consultationDispatchBudget({...retained,...patch}),code('assistant_quota_exceeded'));
  assert.throws(()=>consultationScenarioPreflight({...retained,scenarioAccountedTokens:1,requestReservations:Array(10).fill(60000)}),code('assistant_quota_exceeded'));
  assert.throws(()=>consultationScenarioPreflight({...retained,heldTokens:685557,requestReservations:Array(10).fill(60000)}),code('assistant_quota_exceeded'));
  assert.throws(()=>consultationDispatchBudget({...retained,knownCostMicros:5000000}),code('assistant_quota_exceeded'));
});
