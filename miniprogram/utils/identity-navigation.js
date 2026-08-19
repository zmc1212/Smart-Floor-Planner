const ROLE_LANDING_PATHS = Object.freeze({
  customer: '/pages/index/index',
  referrer: '/packages/business/referrer-workbench/referrer-workbench',
  staff: '/pages/index/index',
  designer: '/pages/index/index',
  measurer: '/pages/index/index',
  enterprise_admin: '/pages/index/index'
});

const ROLE_CAPABILITIES = Object.freeze({
  customer: ['customer.service', 'customer.projects', 'account'],
  referrer: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'],
  designer: ['staff.leads', 'staff.appointments', 'staff.design', 'account'],
  measurer: ['staff.schedule', 'staff.tasks', 'staff.surveying', 'account'],
  enterprise_admin: ['enterprise.operations', 'enterprise.customers', 'enterprise.appointments', 'account'],
  staff: ['staff.leads', 'staff.appointments', 'account']
});

const ROUTE_CAPABILITIES = Object.freeze({
  '/pages/index/index': ['customer.service', 'staff.leads', 'staff.schedule', 'enterprise.operations'],
  '/pages/leads-management/leads-management': ['staff.leads', 'staff.tasks', 'enterprise.customers'],
  '/pages/ai-design/ai-design': ['staff.design', 'staff.surveying', 'enterprise.appointments'],
  '/packages/ai-workflow/create/ai-design-create': 'staff.design',
  '/packages/ai-workflow/result/ai-design-result': 'staff.design',
  '/packages/ai-workflow/history/ai-design-history': 'staff.design',
  '/packages/business/lead-detail/lead-detail': ['staff.leads', 'staff.tasks', 'enterprise.customers'],
  '/packages/business/lead-form/lead-form': 'enterprise.customers',
  '/packages/business/appointment-booking/appointment-booking': ['customer.projects', 'staff.appointments', 'enterprise.appointments'],
  '/packages/business/appointment-detail/appointment-detail': ['customer.projects', 'staff.appointments', 'staff.schedule', 'enterprise.appointments'],
  '/packages/business/appointment-reschedule/appointment-reschedule': ['customer.projects', 'staff.appointments', 'enterprise.appointments'],
  '/packages/surveying/editor/surveying-editor': 'staff.surveying',
  '/packages/business/measurer-calendar/measurer-calendar': 'staff.schedule',
  '/packages/business/measurer-unavailability/measurer-unavailability': 'staff.schedule',
  '/packages/business/referrer-workbench/referrer-workbench': 'referrer.promotion',
  '/packages/business/referrer-progress/referrer-progress': 'referrer.progress',
  '/packages/business/referrer-earnings/referrer-earnings': 'referrer.earnings',
  '/packages/business/promotion-records/promotion-records': 'enterprise.customers',
  '/packages/business/promotion-record-detail/promotion-record-detail': 'enterprise.customers',
  '/packages/business/commission-records/commission-records': 'enterprise.operations',
  '/packages/business/inspiration/inspiration': 'staff.design',
  '/packages/business/recommendations/index': 'staff.design',
  '/packages/business/promotion-service-code/promotion-service-code': 'referrer.promotion',
  '/packages/business/customer-projects/customer-projects': 'customer.projects',
  '/packages/business/customer-project/customer-project': 'customer.projects',
  '/pages/mine/mine': 'account',
  '/packages/business/settings/settings': 'account',
  '/packages/business/identity-switch/identity-switch': 'account',
  '/packages/business/account-security/account-security': 'account'
});

function roleForIdentity(value) {
  if (!value) return null;
  if ((value.mode === 'staff' || value.role === 'staff')
    && ROLE_CAPABILITIES[value.staffRole]
    && value.staffRole !== 'staff') {
    return value.staffRole;
  }
  if (value.role && ROLE_CAPABILITIES[value.role]) return value.role;
  if (value.mode === 'referrer') return 'referrer';
  if (value.mode === 'customer') return 'customer';
  if (value.role === 'user') return 'customer';
  if (value.mode === 'staff') {
    return null;
  }
  return null;
}

function normalizeIdentity(identity) {
  const value = identity || {};
  const mode = value.mode || (value.role === 'staff' ? 'staff' : null);
  return { ...value, mode, role: roleForIdentity(value) };
}

function getRoleLanding(identity) {
  const normalized = normalizeIdentity(identity);
  return normalized.landingPath || ROLE_LANDING_PATHS[normalized.role] || null;
}

function routePath(route) {
  return `/${String(route || '').replace(/^\/+/, '').split('?')[0]}`;
}

function isRoleLanding(route, identity) {
  return routePath(route) === getRoleLanding(identity);
}

function navigateToRoleLanding(identity, options = {}) {
  const url = getRoleLanding(identity);
  if (!url) return false;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
  if (isRoleLanding(current, identity)) return false;

  const method = options.relaunch === false ? 'switchTab' : 'reLaunch';
  if (typeof wx[method] !== 'function') return false;
  wx[method]({ url });
  return true;
}

function canAccessRoute(route, bootstrapOrIdentity) {
  const path = routePath(route);
  const required = ROUTE_CAPABILITIES[path];
  if (!required) return true;
  const bootstrap = bootstrapOrIdentity && bootstrapOrIdentity.current
    ? bootstrapOrIdentity
    : null;
  const capabilities = bootstrap
    ? (bootstrap.current.capabilities || (bootstrap.navigation && bootstrap.navigation.capabilities) || [])
    : (ROLE_CAPABILITIES[roleForIdentity(bootstrapOrIdentity)] || []);
  return Array.isArray(required)
    ? required.some((capability) => capabilities.includes(capability))
    : capabilities.includes(required);
}

function guardDeepLink(route, bootstrapOrIdentity) {
  const allowed = canAccessRoute(route, bootstrapOrIdentity);
  if (allowed) return { allowed: true, route: routePath(route), reason: null };
  const current = bootstrapOrIdentity && bootstrapOrIdentity.current
    ? bootstrapOrIdentity.current
    : bootstrapOrIdentity;
  return {
    allowed: false,
    route: routePath(route),
    reason: 'identity_route_forbidden',
    redirectPath: getRoleLanding(current)
  };
}

module.exports = {
  ROLE_LANDING_PATHS,
  ROLE_CAPABILITIES,
  ROUTE_CAPABILITIES,
  roleForIdentity,
  normalizeIdentity,
  getRoleLanding,
  isRoleLanding,
  navigateToRoleLanding,
  canAccessRoute,
  guardDeepLink
};
