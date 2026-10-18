/** Reversible rollout for the explicitly approved development integration tenant.
 * Never enables production or another tenant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { resolvePostgresRuntimeConfig, closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmRuntimeConfig, savePlatformLlmConfig } from '@/lib/platform-llm-config';
import { agentPromptVersion } from '@/lib/assistant/agent/context';

loadEnvConfig(process.cwd(), true);
async function main() {
  const action = process.argv[2] || '--read';
  if (!['--read','--enable-text','--enable-agent','--disable','--configure-deepseek'].includes(action)) throw Error('Unsupported development action');
  const url = new URL(resolvePostgresRuntimeConfig().connectionString);
  if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '5432' || url.pathname !== '/smart_floor_planner') throw Error('Approved primary development tunnel required');
  const enterpriseId = '1454';
  const provider = await getPlatformLlmRuntimeConfig();
  const deepseek = provider.providerKey === 'deepseek' && new URL(provider.baseUrl).origin === 'https://api.deepseek.com';
  const model = deepseek ? 'deepseek-flash' : 'Qwen/Qwen3.5-4B';
  if (action === '--enable-text' || action === '--enable-agent' || action === '--configure-deepseek') {
    if (!provider.enabled || !(deepseek || provider.providerKey === 'siliconflow')) throw Error('Unsupported development provider');
    if (action !== '--configure-deepseek' && (process.env.ASSISTANT_TEXT_MODEL !== model || provider.model !== model)) throw Error('Runtime model configuration must match the probe');
    const report = JSON.parse(fs.readFileSync(path.resolve(`../tmp/xiaok-vector/p2m-evaluation-${agentPromptVersion}${deepseek ? '-deepseek-flash' : ''}.json`), 'utf8'));
    if (report.model !== model || report.providerKey !== provider.providerKey || report.agentPromptVersion !== agentPromptVersion || report.outputs.length !== 160 || report.outputs.filter((r: { pass: boolean }) => r.pass).length < 152
      || (action !== '--configure-deepseek' && ['memory','tools','permission','recovery'].some(group => report.byGroup[group].structuralPass !== report.byGroup[group].total))) throw Error('Development structural baseline not met');
    if (action === '--enable-agent') {
      if (!deepseek || report.outputs.some((r: { pass: boolean }) => !r.pass)) throw Error('Full DeepSeek structural suite must pass');
      const vision = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/p2m-vision-' + agentPromptVersion + '-deepseek-flash.json'), 'utf8'));
      const live = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-vector/p2m-live-' + agentPromptVersion + '-deepseek-flash.json'), 'utf8'));
      if ([vision,live].some(r => !r.passed || r.agentPromptVersion !== agentPromptVersion || r.model !== model || r.providerKey !== provider.providerKey)
        || vision.outputs.length !== 16 || vision.outputs.some((r: { pass: boolean }) => !r.pass)
        || live.pattern !== null || !live.isolated || !live.files.includes('assistant-agent.test.ts')) throw Error('Semantic vision and full live database regression must pass');
    }
  }
  if (action === '--configure-deepseek') {
    if (!deepseek) throw Error('Official DeepSeek configuration required');
    const backup = path.resolve('../tmp/xiaok-vector/p2m-model-before-deepseek.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify({ enabled: provider.enabled, providerKey: provider.providerKey, baseUrl: provider.baseUrl, model: provider.model, assistantModel: process.env.ASSISTANT_TEXT_MODEL, disableThinking: process.env.ASSISTANT_TEXT_DISABLE_THINKING }, null, 2));
    const saved = await savePlatformLlmConfig({ enabled: provider.enabled, providerKey: provider.providerKey, baseUrl: provider.baseUrl, model });
    console.log(JSON.stringify({ scope: 'development platform LLM configuration', model: saved.model, providerKey: saved.providerKey, credentialsPreserved: true, backup }));
    return;
  }
  const result = await withTenantTransaction(enterpriseId, async tx => {
    const setting = await one(tx, sql`select enabled,agent_config,policy_version,daily_requests,daily_tokens from app.assistant_enterprise_settings where enterprise_id=${enterpriseId} for update`);
    if (!setting?.enabled) throw Error('Existing development assistant must already be enabled');
    const active = await one(tx, sql`select count(*) as n from app.assistant_runs where enterprise_id=${enterpriseId} and status in ('queued','running')`);
    if (action === '--read') return { enterpriseId, ...setting, activeRuns: Number(active?.n || 0) };
    if (Number(active?.n || 0)) throw Error('Active development runs; keep current configuration');
    const prior = setting.agent_config as { runtime?: string; model?: string; imageInput?: boolean };
    if (prior.runtime !== 'extractive-v1' && !(prior.runtime === 'langgraph-v1' && ['Qwen/Qwen3.5-4B','deepseek-flash'].includes(prior.model || '') && typeof prior.imageInput === 'boolean')) throw Error('Unexpected existing Agent configuration');
    const config = action === '--disable' ? { runtime: 'extractive-v1' } : {
      runtime: 'langgraph-v1', model, providerKey: provider.providerKey, imageInput: action === '--enable-agent', tools: true, probeVersion: `p2m-synthetic-80-v1:${agentPromptVersion}:${provider.providerKey}:${model}`,
    };
    if (JSON.stringify(config) === JSON.stringify(prior)) return { enterpriseId, unchanged: true, config };
    await tx.execute(sql`update app.assistant_enterprise_settings set agent_config=${JSON.stringify(config)}::jsonb,policy_version=policy_version+1,version=version+1,updated_at=now() where enterprise_id=${enterpriseId}`);
    return { enterpriseId, previous: prior, config, policyVersion: Number(setting.policy_version) + 1, customerImagesEnabled: action === '--enable-agent' };
  });
  console.log(JSON.stringify(result));
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Development configuration failed'); process.exitCode = 1; }).finally(closePostgresPool);
