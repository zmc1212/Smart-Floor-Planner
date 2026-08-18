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

export const ALL_MENUS = [
  { key: 'dashboard', label: '概览' },
  { key: 'enterprises', label: '企业管理' },
  { key: 'ai-providers', label: 'AI 供应商' },
  { key: 'media-storage', label: '媒体存储' },
  { key: 'ai-credit-prices', label: 'AI 点数价格' },
  { key: 'roles', label: '角色权限管理' },
  { key: 'floorplans', label: '户型图库' },
  { key: 'users', label: '用户审计' },
  { key: 'devices', label: '设备管理' },
  { key: 'measurements', label: '量房记录' },
  { key: 'leads', label: '客户线索' },
  { key: 'promotion-records', label: '企业报备' },
  { key: 'workflow-logs', label: '提醒日志' },
  { key: 'enterprise-orders', label: '成交订单' },
  { key: 'commissions', label: '提成结算' },
  { key: 'acquisition-commissions', label: '获客提成' },
  { key: 'lead-commissions', label: '三方提成' },
  { key: 'ai-scenarios', label: 'AI 设计' },
  { key: 'ai-presets', label: 'AI 预设配置' },
  { key: 'inspirations', label: '灵感方案' },
  { key: 'staff', label: '员工管理' },
  { key: 'packages', label: '套餐管理' },
  { key: 'admins', label: '系统账号管理' },
];

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MENUS.map((menu) => menu.key),
  admin: [
    'dashboard',
    'enterprises',
    'ai-providers',
    'media-storage',
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
    'acquisition-commissions',
    'lead-commissions',
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
    'acquisition-commissions',
    'lead-commissions',
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
  measurer: ['dashboard', 'leads', 'measurements', 'devices', 'floorplans'],
  viewer: [
    'dashboard',
    'floorplans',
    'ai-floorplan',
    'ai-furnishing',
    'ai-soft-furnishing',
    'inspirations',
  ],
};
