const ROLE_LANDING_PATHS = Object.freeze({
  customer: '/pages/index/index',
  referrer: '/packages/business/referrer-workbench/referrer-workbench',
  staff: '/pages/index/index',
  designer: '/pages/index/index',
  measurer: '/pages/index/index',
  salesperson: '/packages/business/promotion-records/promotion-records',
  enterprise_admin: '/pages/index/index',
  platform_admin: '/packages/platform/devices/devices'
});

const ROLE_CAPABILITIES = Object.freeze({
  customer: ['customer.service', 'customer.projects', 'account'],
  referrer: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'],
  designer: ['staff.leads', 'staff.data', 'staff.appointments', 'staff.design', 'staff.earnings', 'referrer.network', 'account'],
  measurer: ['staff.schedule', 'staff.data', 'staff.tasks', 'staff.surveying', 'staff.earnings', 'referrer.network', 'account'],
  salesperson: ['promotion.records', 'promotion.commissions', 'referrer.network', 'account'],
  enterprise_admin: ['enterprise.operations', 'enterprise.customers', 'enterprise.appointments', 'enterprise.commissions', 'referrer.network', 'account'],
  platform_admin: ['platform.review', 'platform.devices', 'account'],
  staff: ['staff.leads', 'staff.appointments', 'account']
});

const ROUTE_CAPABILITIES = Object.freeze({
  '/pages/index/index': ['customer.service', 'staff.leads', 'staff.schedule', 'enterprise.operations'],
  '/pages/enterprise-operations/enterprise-operations': ['staff.data', 'enterprise.operations'],
  '/pages/leads-management/leads-management': ['staff.leads', 'staff.tasks', 'enterprise.customers'],
  '/pages/ai-design/ai-design': ['staff.design', 'staff.surveying'],
  '/packages/platform/devices/devices': 'platform.devices',
  '/packages/platform/enterprise-review/enterprise-review': 'platform.review',
  '/packages/platform/enterprise-review-detail/enterprise-review-detail': 'platform.review',
  '/packages/platform/registration-code/registration-code': 'platform.review',
  '/packages/ai-workflow/create/ai-design-create': 'staff.design',
  '/packages/ai-workflow/result/ai-design-result': 'staff.design',
  '/packages/ai-workflow/history/ai-design-history': 'staff.design',
  '/packages/business/lead-detail/lead-detail': ['staff.leads', 'staff.tasks', 'enterprise.customers'],
  '/packages/business/lead-form/lead-form': ['staff.leads', 'staff.tasks', 'enterprise.customers'],
  '/packages/business/appointment-booking/appointment-booking': ['customer.projects', 'staff.appointments', 'staff.tasks', 'enterprise.appointments'],
  '/packages/business/appointment-detail/appointment-detail': ['customer.projects', 'staff.appointments', 'staff.schedule', 'enterprise.appointments'],
  '/packages/business/appointment-reschedule/appointment-reschedule': ['customer.projects', 'staff.appointments', 'enterprise.appointments'],
  '/packages/surveying/editor/surveying-editor': ['staff.surveying', 'staff.leads', 'enterprise.customers'],
  '/packages/business/measurer-calendar/measurer-calendar': 'staff.schedule',
  '/packages/business/enterprise-appointments/enterprise-appointments': 'enterprise.appointments',
  '/packages/business/enterprise-commissions/enterprise-commissions': 'enterprise.commissions',
  '/packages/business/measurer-unavailability/measurer-unavailability': ['staff.schedule', 'staff.appointments'],
  '/packages/business/referrer-workbench/referrer-workbench': 'referrer.promotion',
  '/packages/guides/referrer-guide/referrer-guide': 'referrer.promotion',
  '/packages/guides/enterprise-owner-guide/enterprise-owner-guide': 'enterprise.operations',
  '/packages/guides/designer-guide/designer-guide': 'staff.leads',
  '/packages/guides/measurer-guide/measurer-guide': 'staff.schedule',
  '/packages/business/referrer-progress/referrer-progress': 'referrer.progress',
  '/packages/business/referrer-earnings/referrer-earnings': 'referrer.earnings',
  '/packages/business/staff-earnings/staff-earnings': 'staff.earnings',
  '/packages/business/promotion-records/promotion-records': ['enterprise.customers', 'promotion.records'],
  '/packages/business/promotion-record-detail/promotion-record-detail': ['enterprise.customers', 'promotion.records'],
  '/packages/business/commission-records/commission-records': ['enterprise.operations', 'promotion.commissions'],
  '/packages/business/inspiration/inspiration': 'staff.design',
  '/packages/business/recommendations/index': 'staff.design',
  '/packages/business/promotion-service-code/promotion-service-code': 'referrer.promotion',
  '/packages/business/staff-activity-code/staff-activity-code': ['staff.leads', 'staff.tasks', 'staff.schedule', 'enterprise.operations'],
  '/packages/business/enterprise-join-codes/enterprise-join-codes': 'referrer.network',
  '/packages/business/enterprise-staff/enterprise-staff': 'enterprise.operations',
  '/packages/business/enterprise-referrers/enterprise-referrers': 'referrer.network',
  '/packages/business/enterprise-referrer-branch/enterprise-referrer-branch': 'referrer.network',
  '/packages/business/customer-projects/customer-projects': 'customer.projects',
  '/packages/business/customer-project/customer-project': 'customer.projects',
  '/packages/business/service-needs/service-needs': 'customer.projects',
  '/packages/business/customer-ai-schemes/customer-ai-schemes': ['customer.projects', 'staff.leads', 'staff.tasks', 'enterprise.customers', 'account'],
  '/pages/mine/mine': 'account',
  '/packages/business/settings/settings': 'account',
  '/packages/business/identity-switch/identity-switch': 'account',
  '/packages/business/account-security/account-security': 'account'
});

const SCAN_LANDING_ROUTES = Object.freeze([
  '/packages/business/enterprise-register/enterprise-register',
  '/packages/business/onboarding/onboarding',
  '/packages/business/free-design-service/free-design-service'
]);
const STICKY_SCAN_REOPEN_SCENES = Object.freeze([
  1001,
  1023,
  1089,
  1090,
  1103,
  1104
]);

function roleForIdentity(value) {
  if (!value) return null;
  if (value.staffRole === 'admin' || value.staffRole === 'super_admin'
    || value.role === 'admin' || value.role === 'super_admin') {
    return 'platform_admin';
  }
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

function capabilitiesMatch(required, capabilities) {
  return Array.isArray(required)
    ? required.some((capability) => capabilities.includes(capability))
    : capabilities.includes(required);
}

function availableRoleCapabilities(bootstrap) {
  const roles = bootstrap && Array.isArray(bootstrap.roles) ? bootstrap.roles : [];
  return roles.flatMap((item) => item.capabilities || ROLE_CAPABILITIES[item.role] || []);
}

function hasEnterpriseContext(identity) {
  const value = identity && identity.enterpriseId;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return false;
  return /^[1-9]\d*$/.test(String(value == null ? '' : value).trim());
}

function fallbackRoleCapabilities(identity) {
  const capabilities = ROLE_CAPABILITIES[roleForIdentity(identity)] || [];
  return capabilities.filter((capability) => (
    capability !== 'referrer.network' || hasEnterpriseContext(identity)
  ));
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
    : fallbackRoleCapabilities(bootstrapOrIdentity);
  if (capabilitiesMatch(required, capabilities)) return true;
  // Replay-only: a signed customer may reopen a guide they already hold as
  // another identity. Other workbench routes still require the current JWT.
  if (path.startsWith('/packages/guides/') && bootstrap) {
    return capabilitiesMatch(required, availableRoleCapabilities(bootstrap));
  }
  return false;
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

function isScanLandingRoute(route) {
  return SCAN_LANDING_ROUTES.includes(routePath(route));
}

function isStickyScanReopenScene(scene) {
  return STICKY_SCAN_REOPEN_SCENES.includes(Number(scene));
}

function currentEnterScene(fallback) {
  if (typeof wx !== 'undefined' && typeof wx.getEnterOptionsSync === 'function') {
    try {
      const enter = wx.getEnterOptionsSync();
      if (enter && enter.scene != null && enter.scene !== '') {
        return enter.scene;
      }
    } catch (error) {
      // Some test/runtime hosts throw when enter options are missing.
    }
  }
  return fallback;
}

function shouldLeaveScanLanding(route, identity, scene) {
  if (!isScanLandingRoute(route)) return false;
  const role = roleForIdentity(identity);
  if (isStickyScanReopenScene(scene)) return Boolean(role);
  return false;
}

function leaveScanLanding(identity) {
  if (navigateToRoleLanding(identity)) return true;
  if (typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
    wx.switchTab({ url: '/pages/mine/mine' });
    return true;
  }
  return false;
}

module.exports = {
  ROLE_LANDING_PATHS,
  ROLE_CAPABILITIES,
  ROUTE_CAPABILITIES,
  SCAN_LANDING_ROUTES,
  STICKY_SCAN_REOPEN_SCENES,
  roleForIdentity,
  normalizeIdentity,
  getRoleLanding,
  hasEnterpriseContext,
  isRoleLanding,
  navigateToRoleLanding,
  fallbackRoleCapabilities,
  canAccessRoute,
  guardDeepLink,
  isScanLandingRoute,
  isStickyScanReopenScene,
  currentEnterScene,
  shouldLeaveScanLanding,
  leaveScanLanding
};
