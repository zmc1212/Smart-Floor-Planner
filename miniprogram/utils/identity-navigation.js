const ROLE_LANDING_PATHS = Object.freeze({
  customer: '/pages/index/index',
  referrer: '/packages/business/referrer-workbench/referrer-workbench',
  staff: '/pages/mine/mine'
});

function normalizeIdentity(identity) {
  const value = identity || {};
  const mode = value.mode || (value.role === 'staff' ? 'staff' : 'customer');
  return { ...value, mode };
}

function getRoleLanding(identity) {
  const normalized = normalizeIdentity(identity);
  return normalized.landingPath || ROLE_LANDING_PATHS[normalized.mode] || ROLE_LANDING_PATHS.customer;
}

function routePath(route) {
  return `/${String(route || '').replace(/^\/+/, '').split('?')[0]}`;
}

function isRoleLanding(route, identity) {
  return routePath(route) === getRoleLanding(identity);
}

function navigateToRoleLanding(identity, options = {}) {
  const url = getRoleLanding(identity);
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
  if (isRoleLanding(current, identity)) return false;

  const method = options.relaunch === false ? 'switchTab' : 'reLaunch';
  if (typeof wx[method] !== 'function') return false;
  wx[method]({ url });
  return true;
}

module.exports = {
  ROLE_LANDING_PATHS,
  normalizeIdentity,
  getRoleLanding,
  isRoleLanding,
  navigateToRoleLanding
};
