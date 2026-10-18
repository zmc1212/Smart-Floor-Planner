/** Shared metadata only. Credentials and provider implementations stay server-side. */
export const MAP_PROVIDERS = [
  { key: 'amap', label: '高德地图', implemented: true, description: '住宅小区检索与点选核验' },
  { key: 'tianditu', label: '天地图', implemented: true, description: '行政区划小区检索；需配置独立服务 Key，真实联调待完成' },
] as const;
export type MapProviderKey = typeof MAP_PROVIDERS[number]['key'];
export function isMapProviderKey(value: unknown): value is MapProviderKey { return value === 'amap' || value === 'tianditu'; }

export type MapRights = {
  commercialConfirmed: boolean;
  bindingConfirmed: boolean;
  reference: string;
  validUntil: string;
};
export type MapConfigDto = {
  version: number;
  enabled: boolean;
  activeProvider: string;
  dailyLimit: number;
  hasApiKey: boolean;
  hasSigningKey: boolean;
  apiKeyMasked: string;
  signingKeyMasked: string;
  rights: MapRights;
  available: boolean;
  unavailableReason: string | null;
  canImportEnvironment: boolean;
  lastTest: { ok: boolean; message: string; at: string; elapsedMs: number } | null;
  providerConfigs: Record<MapProviderKey, {
    hasApiKey: boolean; hasSigningKey: boolean; apiKeyMasked: string; signingKeyMasked: string;
    rights: MapRights; lastTest: MapConfigDto['lastTest'];
  }>;
};

export const MAP_ERRORS: Record<string, string> = {
  community_provider_unconfigured: '请先配置当前地图供应商的服务 Key。',
  community_provider_disabled: '地图服务尚未启用，请由平台管理员在地图服务配置中开启。',
  community_provider_unavailable: '地图查询超时或暂不可用，请稍后重试。',
  community_provider_denied: '地图供应商拒绝了请求，请检查 Key 类型、接口权限、签名或 IP 白名单。',
  community_provider_quota: '地图供应商调用额度已达上限，请检查供应商账户配额。',
  community_rate_limited: '查询过于频繁，请稍后重试。',
  map_config_conflict: '配置已被更新，请刷新后重新操作。',
  map_provider_not_implemented: '该地图供应商尚未接入，当前不能切换启用。',
  map_config_invalid: '配置格式不正确，请检查必填项和调用上限。',
  map_encryption_unavailable: '服务端凭据加密配置不可用，请联系部署管理员。',
  map_key_unreadable: '已保存的凭据无法解密，请重新填写 Key。',
  map_environment_missing: '当前服务没有可导入的高德 Key。',
  map_test_rate_limited: '连接测试每分钟最多 3 次，请稍后再试。',
  map_test_daily_limited: '连接测试当天已达 30 次上限，请明天再试。',
  map_config_unavailable: '地图配置暂不可用，请稍后重试。',
  Unauthorized: '登录已失效，请重新登录。',
  Forbidden: '仅平台管理员可以管理地图服务。',
};
