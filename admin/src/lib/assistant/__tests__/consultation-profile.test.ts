import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultationBinding, consultationDispatchBudget, consultationCostUpperMicros, consultationScenarioPreflight,
  type FreeConsultationBinding, type MeteredConsultationBinding } from '../agent/consultation-profile';
import { consultationAcceptanceProfile as profile, consultationLongProfile, consultationCashAuthorization,
  consultationTariffVersion } from '@/lib/assistant/contracts/consultation';
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
