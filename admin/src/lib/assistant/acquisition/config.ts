import { fail } from '../contracts';
import { defaultAcquisitionConfig, type AcquisitionConfig, type AcquisitionPrompt } from './defaults';

export { defaultAcquisitionConfig };
export type { AcquisitionConfig, AcquisitionPrompt };

const text = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && Array.from(trimmed).length <= max ? trimmed : null;
};

/** Strict shape for the one enterprise-level acquisition script. Brand mode is
 * evaluated again per entry code, so anonymous promoter codes never inherit a
 * branded staff landing by accident. */
export function validateAcquisitionConfig(value: unknown): AcquisitionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['brandMode', 'opening', 'prompts'].includes(key))) fail('invalid_message', 422);
  if (!['anonymous', 'branded'].includes(String(input.brandMode))) fail('invalid_message', 422);
  const opening = text(input.opening, 600);
  if (!opening) fail('invalid_message', 422);
  if (!Array.isArray(input.prompts) || input.prompts.length > 3) fail('invalid_message', 422);
  const prompts: AcquisitionPrompt[] = input.prompts.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('invalid_message', 422);
    const prompt = item as Record<string, unknown>;
    if (Object.keys(prompt).some(key => !['title', 'text'].includes(key))) fail('invalid_message', 422);
    const title = text(prompt.title, 12);
    const body = text(prompt.text, 80);
    if (!title || !body) fail('invalid_message', 422);
    return { title, text: body };
  });
  if (new Set(prompts.map(prompt => prompt.title)).size !== prompts.length) fail('invalid_message', 422);
  return { brandMode: input.brandMode as AcquisitionConfig['brandMode'], opening, prompts };
}

export function configuredAcquisition(value: unknown): AcquisitionConfig {
  try {
    return value ? validateAcquisitionConfig(value) : defaultAcquisitionConfig;
  } catch {
    return defaultAcquisitionConfig;
  }
}

export type AcquisitionEnterprise = { name?: string | null; logo?: string | null };

/** Anonymous entries return no enterprise identity at all; the client renders a
 * generic local-service label until phone authorization creates the lead. */
export function acquisitionBrand(config: AcquisitionConfig, enterprise: AcquisitionEnterprise | null) {
  if (config.brandMode !== 'branded') return { brandMode: 'anonymous' as const, brandName: null, brandLogo: null };
  return {
    brandMode: 'branded' as const,
    brandName: text(enterprise?.name, 120),
    brandLogo: text(enterprise?.logo, 2048)
  };
}

export function acquisitionEntryView(
  config: AcquisitionConfig,
  enterprise: AcquisitionEnterprise | null,
  version: number
) {
  return {
    ...acquisitionBrand(config, enterprise),
    opening: config.opening,
    prompts: config.prompts,
    version
  };
}
