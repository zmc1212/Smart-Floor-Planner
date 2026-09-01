export type AdminRouteEntry = {
  key: string;
  label: string;
  href: string;
  section: string;
  permissionKey?: string;
};

export const ADMIN_ROUTE_CONFIG: AdminRouteEntry[] = [
  { key: 'dashboard', label: '业务概览', href: '/', section: '运营工作台' },
  { key: 'ai-providers', label: 'AI 供应商', href: '/ai-providers', section: '平台管理中心' },
  { key: 'ai-models', label: '生图模型', href: '/ai-models', section: '平台管理中心', permissionKey: 'ai-providers' },
  { key: 'ai-presets', label: 'AI 预设配置', href: '/ai-presets', section: 'AI 辅助设计' },
  { key: 'ai-credit-prices', label: 'AI 点数价格', href: '/ai-credit-prices', section: '平台管理中心' },
  { key: 'media-storage', label: '媒体存储', href: '/media-storage', section: '平台管理中心' },
  { key: 'mini-program-code-settings', label: '小程序码环境', href: '/mini-program-code-settings', section: '平台管理中心' },
  { key: 'sms-settings', label: '短信设置', href: '/sms-settings', section: '平台管理中心' },
  { key: 'enterprise-registration-codes', label: '企业开户码', href: '/enterprise-registration-codes', section: '平台管理中心', permissionKey: 'enterprises' },
  { key: 'users', label: '用户审计', href: '/users', section: '平台管理中心' },
  { key: 'floorplans', label: '户型图库', href: '/floorplans', section: '户型图库' },
  { key: 'lead-commissions', label: '三方提成', href: '/lead-commissions', section: '团队资产管理' },
  { key: 'referrer-network-operations', label: '运营工作台', href: '/referrer-network-operations', section: '推荐网络' },
  { key: 'join-codes', label: '入驻码', href: '/join-codes', section: '推荐网络', permissionKey: 'referrer-network-operations' },
  { key: 'referrers', label: '推荐人', href: '/referrers', section: '推荐网络', permissionKey: 'referrers' },
  { key: 'appointment-settings', label: '预约设置', href: '/appointment-settings', section: '推荐网络', permissionKey: 'referrer-network-operations' },
];

export function isAdminRouteActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getAdminRoute(pathname: string) {
  return ADMIN_ROUTE_CONFIG
    .filter((route) => isAdminRouteActive(pathname, route.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
}
