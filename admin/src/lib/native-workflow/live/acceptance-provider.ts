/** Read-only provider preflight for the B acceptance drivers.
 *
 * The B tenant's `llm-settings-override` provider and platform LLM override are
 * initialized by the separate B environment setup step. An acceptance driver
 * may only verify and reuse them: it never copies MAIN configuration, never
 * decrypts credentials and never inserts or updates provider rows. Missing or
 * disabled configuration is a clear preflight failure, before any report
 * enqueue or temporary config mutation.
 */

export interface AcceptanceProviderRow {
  key: string;
  enabled: boolean | null;
  adapter_type: string;
  base_url: string;
  api_key_masked: string | null;
}

export interface AcceptancePlatformConfig {
  enabled?: boolean;
  providerKey?: string;
  model?: string;
  apiKeyMasked?: string;
  [key: string]: unknown;
}

export type AcceptanceProviderReadiness =
  | {
      ok: true;
      provider: AcceptanceProviderRow;
      platform: AcceptancePlatformConfig;
    }
  | {
      ok: false;
      error: string;
    };

export function evaluateAcceptanceProviderReadiness(input: {
  provider: AcceptanceProviderRow | null;
  platform: AcceptancePlatformConfig | null;
}): AcceptanceProviderReadiness {
  const { provider, platform } = input;
  if (!provider) {
    return {
      ok: false,
      error: 'the B llm-settings-override provider is missing; initialize the B provider and platform in a separate step before running this acceptance',
    };
  }
  if (provider.enabled !== true) {
    return {
      ok: false,
      error: 'the B llm-settings-override provider is disabled; enable it in the separate B environment setup before running this acceptance',
    };
  }
  if (!platform) {
    return {
      ok: false,
      error: 'the B platform LLM override is missing; initialize the B provider and platform in a separate step before running this acceptance',
    };
  }
  if (platform.enabled !== true) {
    return {
      ok: false,
      error: 'the B platform LLM override is disabled; enable it in the separate B environment setup before running this acceptance',
    };
  }
  return { ok: true, provider, platform };
}
