import { fail } from '@/lib/assistant/contracts';
import { AmapCommunityProvider, type CommunityPoi, type CommunityProviderConfig } from '@/lib/portfolio/community-provider';
import { TiandituCommunityProvider } from './tianditu';

export interface CommunityProvider {
  readonly config: CommunityProviderConfig;
  search(city: string, query: string): Promise<CommunityPoi[]>;
  detail(city: string, poiId: string, name?: string): Promise<CommunityPoi>;
}
/** Add a verified adapter here before enabling a provider in the shared catalog. */
export function createCommunityProvider(config: CommunityProviderConfig, transport: typeof fetch = fetch): CommunityProvider {
  if (!config.providerKey || config.providerKey === 'amap') return new AmapCommunityProvider(config, transport);
  if (config.providerKey === 'tianditu') return new TiandituCommunityProvider(config, transport);
  return fail('map_provider_not_implemented', 422);
}
