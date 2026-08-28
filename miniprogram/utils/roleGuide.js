const ROLE_GUIDES = Object.freeze({
  referrer: Object.freeze({
    role: 'referrer',
    version: 'v1',
    capability: 'referrer.promotion',
    path: '/packages/guides/referrer-guide/referrer-guide'
  }),
  enterprise_admin: Object.freeze({
    role: 'enterprise_admin',
    version: 'v1',
    capability: 'enterprise.operations',
    path: '/packages/guides/enterprise-owner-guide/enterprise-owner-guide'
  }),
  designer: Object.freeze({
    role: 'designer',
    version: 'v1',
    capability: 'staff.leads',
    path: '/packages/guides/designer-guide/designer-guide'
  }),
  measurer: Object.freeze({
    role: 'measurer',
    version: 'v1',
    capability: 'staff.schedule',
    path: '/packages/guides/measurer-guide/measurer-guide'
  })
});

function guideForRole(role) {
  return ROLE_GUIDES[role] || null;
}

function hasRoleGuide(role) {
  return Boolean(guideForRole(role));
}

const ROLE_GUIDE_LABELS = Object.freeze({
  referrer: '推广人使用引导',
  enterprise_admin: '企业负责人使用引导',
  designer: '家装设计顾问使用引导',
  measurer: '家装现场顾问使用引导'
});

function roleFromAccountContext(context) {
  if (!context) return '';
  if (context.role && hasRoleGuide(context.role)) return context.role;
  if (context.mode === 'staff') return context.staffRole || '';
  return context.mode || '';
}

function addGuidedRole(roles, role) {
  if (!hasRoleGuide(role) || roles.includes(role)) return;
  roles.push(role);
}

function guidedRolesFromAccount(activeRole, bootstrap, contexts) {
  const roles = [];
  addGuidedRole(roles, activeRole);
  for (const item of (bootstrap && bootstrap.roles) || []) {
    addGuidedRole(roles, item.role);
  }
  for (const context of contexts || []) {
    addGuidedRole(roles, roleFromAccountContext(context));
  }
  return roles;
}

function mineRoleGuideEntry(activeRole, bootstrap, contexts) {
  const roles = guidedRolesFromAccount(activeRole, bootstrap, contexts);
  return {
    showRoleGuideEntry: roles.length > 0,
    roleGuideHelper: hasRoleGuide(activeRole)
      ? '查看当前身份的工作方法'
      : '回看已有身份的工作方法'
  };
}

function referrerMembershipIdFromAccount(bootstrap, contexts) {
  const current = bootstrap && bootstrap.current && bootstrap.current.context;
  if (current && current.referrerMembershipId) return String(current.referrerMembershipId);
  const group = ((bootstrap && bootstrap.roles) || []).find((item) => item.role === 'referrer');
  const grouped = group && (group.context || (group.contexts && group.contexts[0]));
  if (grouped && grouped.referrerMembershipId) return String(grouped.referrerMembershipId);
  const context = (contexts || []).find((item) => item.mode === 'referrer' && item.referrerMembershipId);
  return context ? String(context.referrerMembershipId) : '';
}

function currentBootstrapRole() {
  const app = typeof getApp === 'function' ? getApp() : null;
  const current = app && app.globalData && app.globalData.bootstrap && app.globalData.bootstrap.current;
  return current && current.role ? current.role : '';
}

function shouldCompleteGuideInCurrentRole(role) {
  const current = currentBootstrapRole();
  return !current || current === role;
}

function openMineRoleGuide(options = {}) {
  const roles = guidedRolesFromAccount(options.activeRole, options.bootstrap, options.contexts);
  if (!roles.length) return false;
  const preferred = hasRoleGuide(options.activeRole) ? options.activeRole : null;
  const target = preferred || (roles.length === 1 ? roles[0] : null);
  const membershipId = options.membershipId || referrerMembershipIdFromAccount(options.bootstrap, options.contexts);
  if (target) {
    return openRoleGuide(target, { source: 'mine', membershipId });
  }
  if (typeof wx === 'undefined' || typeof wx.showActionSheet !== 'function') {
    return openRoleGuide(roles[0], { source: 'mine', membershipId });
  }
  wx.showActionSheet({
    itemList: roles.map((role) => ROLE_GUIDE_LABELS[role] || role),
    success(result) {
      const role = roles[result.tapIndex];
      if (role) openRoleGuide(role, { source: 'mine', membershipId });
    }
  });
  return true;
}

function currentIdentity() {
  const app = typeof getApp === 'function' ? getApp() : null;
  const globalData = app && app.globalData ? app.globalData : {};
  const storedUser = typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function'
    ? wx.getStorageSync('userInfo')
    : null;
  return {
    ...(storedUser || {}),
    ...(globalData.userInfo || {}),
    openid: globalData.openid || (globalData.userInfo && globalData.userInfo.openid)
      || (storedUser && storedUser.openid) || ''
  };
}

function identityScope(identity) {
  const value = identity || currentIdentity();
  const raw = value.openid || value.id || value._id || value.phone || 'device';
  return encodeURIComponent(String(raw)).slice(0, 96);
}

function seenStorageKey(role, identity) {
  const guide = guideForRole(role);
  if (!guide) return '';
  return `roleGuideSeen:${role}:${guide.version}:${identityScope(identity)}`;
}

function hasSeenRoleGuide(role, identity) {
  const key = seenStorageKey(role, identity);
  if (!key || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return false;
  try {
    return wx.getStorageSync(key) === true;
  } catch (error) {
    return false;
  }
}

function markRoleGuideSeen(role, identity) {
  const key = seenStorageKey(role, identity);
  if (!key || typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false;
  try {
    wx.setStorageSync(key, true);
    return true;
  } catch (error) {
    return false;
  }
}

function clampGuideStep(step, totalSteps) {
  const total = Math.max(1, Number(totalSteps) || 1);
  const numeric = Number(step);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(total - 1, Math.trunc(numeric)));
}

function guideSlideState(slides, step) {
  const list = Array.isArray(slides) ? slides : [];
  if (!list.length) {
    return { currentStep: 0, activeSlide: null };
  }
  const currentStep = clampGuideStep(step, list.length);
  return {
    currentStep,
    activeSlide: list[currentStep]
  };
}

function roleGuideUrl(role, options = {}) {
  const guide = guideForRole(role);
  if (!guide) return '';
  const query = [];
  if (options.source) query.push(`source=${encodeURIComponent(options.source)}`);
  if (options.membershipId) query.push(`membershipId=${encodeURIComponent(options.membershipId)}`);
  return `${guide.path}${query.length ? `?${query.join('&')}` : ''}`;
}

function openRoleGuide(role, options = {}) {
  const url = roleGuideUrl(role, options);
  if (!url || typeof wx === 'undefined' || typeof wx.navigateTo !== 'function') return false;
  if (options.automatic && hasSeenRoleGuide(role, options.identity)) return false;
  wx.navigateTo({
    url,
    success: options.success,
    fail: options.fail
  });
  return true;
}

module.exports = {
  ROLE_GUIDES,
  ROLE_GUIDE_LABELS,
  guideForRole,
  hasRoleGuide,
  roleFromAccountContext,
  guidedRolesFromAccount,
  mineRoleGuideEntry,
  referrerMembershipIdFromAccount,
  shouldCompleteGuideInCurrentRole,
  seenStorageKey,
  hasSeenRoleGuide,
  markRoleGuideSeen,
  clampGuideStep,
  guideSlideState,
  roleGuideUrl,
  openRoleGuide,
  openMineRoleGuide
};
