export type AdminRole =
  | 'super_admin'
  | 'admin'
  | 'enterprise_admin'
  | 'designer'
  | 'salesperson'
  | 'measurer'
  | 'viewer';

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '平台管理员',
  enterprise_admin: '企业负责人',
  designer: '设计师',
  salesperson: '渠道地推',
  measurer: '测量员',
  viewer: '只读审计员',
};

/** Menu keys shown on `/roles`. Labels must match `Sidebar` MENU_CONFIG. */
export const ALL_MENUS = [
  { key: 'dashboard', label: '业务概览' },
  { key: 'enterprises', label: '企业管理' },
  { key: 'ai-providers', label: 'AI 供应商' },
  { key: 'media-storage', label: '媒体存储' },
  { key: 'mini-program-code-settings', label: '小程序码环境' },
  { key: 'ai-credit-prices', label: 'AI 点数价格' },
  { key: 'roles', label: '角色权限管理' },
  { key: 'admins', label: '系统管理' },
  { key: 'users', label: '用户审计' },
  { key: 'promotion-records', label: '企业报备' },
  { key: 'packages', label: '套餐管理' },
  { key: 'workflow-logs', label: '通知记录' },
  { key: 'enterprise-orders', label: '成交订单' },
  { key: 'commissions', label: '提成结算中心' },
  { key: 'leads', label: '线索转化' },
  { key: 'referrer-network-operations', label: '推荐网络 / 运营工作台' },
  { key: 'floorplans', label: '户型图库' },
  { key: 'measurements', label: '量房记录' },
  { key: 'ai-scenarios', label: 'AI 工作台' },
  { key: 'inspirations', label: '灵感方案' },
  { key: 'ai-presets', label: 'AI 预设配置' },
  { key: 'staff', label: '员工管理' },
  { key: 'lead-commissions', label: '三方提成' },
  { key: 'devices', label: '设备管理' },
];

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MENUS.map((menu) => menu.key),
  admin: [
    'dashboard',
    'enterprises',
    'ai-providers',
    'media-storage',
    'mini-program-code-settings',
    'ai-credit-prices',
    'roles',
    'floorplans',
    'users',
    'devices',
    'measurements',
    'leads',
    'promotion-records',
    'packages',
    'workflow-logs',
    'enterprise-orders',
    'commissions',
    'lead-commissions',
    'referrer-network-operations',
    'ai-scenarios',
    'ai-presets',
    'inspirations',
    'staff',
    'admins',
  ],
  enterprise_admin: [
    'dashboard',
    'promotion-records',
    'leads',
    'floorplans',
    'measurements',
    'ai-scenarios',
    'inspirations',
    'ai-presets',
    'staff',
    'lead-commissions',
    'referrer-network-operations',
    'devices',
  ],
  designer: [
    'dashboard',
    'leads',
    'floorplans',
    'measurements',
    'ai-scenarios',
    'inspirations',
    'promotion-records',
  ],
  salesperson: ['dashboard', 'promotion-records'],
  measurer: ['dashboard', 'leads', 'measurements', 'floorplans'],
  viewer: [
    'dashboard',
    'floorplans',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'inspirations',
  ],
};
