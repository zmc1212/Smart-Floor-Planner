function hasEnterpriseId(value) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function getStoredUserInfo() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return (app && app.globalData && app.globalData.userInfo)
    || (typeof wx !== 'undefined' && wx.getStorageSync && wx.getStorageSync('userInfo'))
    || null;
}

function canAccessAIDesign(userInfo = getStoredUserInfo()) {
  return Boolean(userInfo && userInfo.role === 'staff' && hasEnterpriseId(userInfo.enterpriseId));
}

function showAIDesignAccessDenied() {
  if (typeof wx !== 'undefined' && wx.showToast) {
    wx.showToast({ title: 'AI 设计仅支持企业员工', icon: 'none' });
  }
}

function ensureAIDesignAccess(userInfo) {
  if (canAccessAIDesign(userInfo)) return true;
  showAIDesignAccessDenied();
  return false;
}

module.exports = {
  canAccessAIDesign,
  ensureAIDesignAccess,
  showAIDesignAccessDenied,
};
