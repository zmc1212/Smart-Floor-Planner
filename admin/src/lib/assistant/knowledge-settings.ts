import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { listProviderRuntimes } from '@/lib/ai/provider-registry';
import { getPlatformLlmConfig } from '@/lib/platform-llm-config';
import { authorizeKnowledgeManager } from './knowledge/manager';
import { AssistantError, fail, id } from './contracts';
import { enterpriseKnowledgeEnabled } from './knowledge-policy';
import { agentConfig } from './agent/config';
import { conversationImageProtocol } from './agent/image-context';
import { supportsChatImageInput, verifiedImageInputPolicy } from './agent/image-input';

async function configuredChatModel() {
  const platform = await getPlatformLlmConfig();
  if (platform.enabled) return platform.available ? platform : null;
  const [runtime] = await listProviderRuntimes('chat', 'chat.general', { initializeEnvironment: false });
  if (runtime?.adapterType !== 'openai_compatible' || !runtime.apiKey) return null;
  const providerKey = runtime.adapterConfig?.providerPreset || runtime.key;
  if (typeof providerKey !== 'string') return null;
  return { providerKey, baseUrl: runtime.baseUrl, model: runtime.modelMappings['chat.general']! };
}

function parseAgentConfig(config: Record<string, unknown>) {
  try { return agentConfig(config); }
  catch (error) { if (error instanceof AssistantError) return null; throw error; }
}

function imageConfiguration(current: Record<string, unknown>, chat: Awaited<ReturnType<typeof configuredChatModel>>) {
  const agent = parseAgentConfig({ ...current, imageInput: current.imageInput === true });
  const override = process.env.ASSISTANT_TEXT_MODEL?.trim();
  const model = agent?.model || override || chat?.model;
  const initializesAgent = !agent && (current.runtime === 'extractive-v1' || current.runtime === undefined);
  if (!chat || !model || (!agent && !initializesAgent) || agent?.consultation
    || (agent && agent.providerKey !== chat.providerKey) || (override && override !== model)
    || !supportsChatImageInput(chat.providerKey, chat.baseUrl, model)) {
    return { model: model || null, initializesAgent: false, config: null };
  }
  const config = {
    ...current,
    ...(initializesAgent ? { runtime: 'langgraph-v1', providerKey: chat.providerKey, model,
      tools: true, probeVersion: verifiedImageInputPolicy } : {}),
    ...(agent?.structuredFinal ? { imageContext: conversationImageProtocol } : {}),
    imageInput: true,
    imageInputPolicy: verifiedImageInputPolicy,
  };
  return { model, initializesAgent, config: parseAgentConfig(config) ? config : null };
}

export class KnowledgeSettingsService {
  constructor(readonly enterpriseId: string, readonly adminId: string) {}
  async execute(input?: Record<string, unknown>) {
    if (input) {
      if (Object.keys(input).some(key => !['expectedVersion', 'expectedEnterpriseId', 'enterpriseKnowledgeEnabled', 'imageInput'].includes(key))
        || !Number.isSafeInteger(input.expectedVersion)
        || (!('enterpriseKnowledgeEnabled' in input) && !('imageInput' in input))
        || ('enterpriseKnowledgeEnabled' in input && typeof input.enterpriseKnowledgeEnabled !== 'boolean')
        || ('imageInput' in input && (typeof input.imageInput !== 'boolean' || !('expectedEnterpriseId' in input)))) fail('invalid_message', 422);
      if ('expectedEnterpriseId' in input && id(input.expectedEnterpriseId) !== this.enterpriseId) fail('settings_enterprise_changed');
    }
    const chat = await configuredChatModel().catch(() => null);
    return withTenantTransaction(this.enterpriseId, async tx => {
      await authorizeKnowledgeManager(tx, this.enterpriseId, this.adminId);
      const current = await one(tx, sql`select enabled,version,agent_config from app.assistant_enterprise_settings
        where enterprise_id=${this.enterpriseId} for update`);
      if (!current) fail('assistant_disabled', 409);
      const existing = current.agent_config && typeof current.agent_config === 'object' && !Array.isArray(current.agent_config)
        ? current.agent_config as Record<string, unknown> : {};
      const currentKnowledge = enterpriseKnowledgeEnabled(existing);
      const currentImages = existing.imageInput === true;
      const knowledge = (input?.enterpriseKnowledgeEnabled as boolean | undefined) ?? currentKnowledge;
      const images = (input?.imageInput as boolean | undefined) ?? currentImages;
      const dto = (version: unknown, config: Record<string, unknown>) => {
        const readiness = imageConfiguration(config, chat);
        return { enterpriseId: this.enterpriseId, version: Number(version), enterpriseKnowledgeEnabled: enterpriseKnowledgeEnabled(config),
          imageInput: config.imageInput === true, imageInputModel: readiness.model,
          canEnableImageInput: current.enabled === true && readiness.config !== null,
          initializesImageAgent: readiness.initializesAgent && readiness.config !== null };
      };
      if (!input || (knowledge === currentKnowledge && images === currentImages)) return dto(current.version, existing);
      if (Number(current.version) !== input.expectedVersion) fail('version_conflict');
      let next = { ...existing };
      if (images !== currentImages) {
        if (images) {
          const readiness = imageConfiguration(existing, chat);
          if (current.enabled !== true || !readiness.config) fail('image_input_unavailable');
          next = readiness.config;
        } else next.imageInput = false;
      }
      if (knowledge !== currentKnowledge) next.enterpriseKnowledgeEnabled = knowledge;
      const saved = await one(tx, sql`update app.assistant_enterprise_settings
        set agent_config=${JSON.stringify(next)}::jsonb,
        policy_version=policy_version+1,version=version+1,updated_at=now()
        where enterprise_id=${this.enterpriseId} returning version`);
      // Existing policy-version checks fence claims, dispatch and commits.
      return dto(saved!.version, next);
    });
  }
}
