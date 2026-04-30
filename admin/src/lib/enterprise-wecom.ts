export interface EnterpriseWecomConfigInput {
  corpId?: unknown;
  agentId?: unknown;
  secret?: unknown;
}

export interface NormalizedWecomConfig {
  corpId: string;
  agentId: string;
  secret: string;
}

export interface NormalizeWecomConfigOptions {
  currentSecret?: string;
}

export interface NormalizeWecomConfigResult {
  mode: 'set' | 'clear';
  value?: NormalizedWecomConfig;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeWecomConfig(
  input: EnterpriseWecomConfigInput | undefined,
  options: NormalizeWecomConfigOptions = {}
): NormalizeWecomConfigResult {
  const corpId = normalizeString(input?.corpId);
  const agentId = normalizeString(input?.agentId);
  const secret = normalizeString(input?.secret);

  if (!corpId && !agentId && !secret) {
    return { mode: 'clear' };
  }

  if (!corpId || !agentId) {
    throw new Error('企业微信配置需要同时填写 CorpID 和 AgentID');
  }

  const finalSecret = secret || normalizeString(options.currentSecret);
  if (!finalSecret) {
    throw new Error('企业微信配置需要填写 Secret');
  }

  return {
    mode: 'set',
    value: {
      corpId,
      agentId,
      secret: finalSecret,
    },
  };
}

export function hasCompleteWecomConfig(input?: {
  corpId?: string;
  agentId?: string;
  secret?: string;
} | null) {
  return Boolean(input?.corpId && input?.agentId && input?.secret);
}
