const api = require('../../../utils/api.js');
const { navigateToRoleLanding, roleForIdentity } = require('../../../utils/identity-navigation.js');

const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';

function onboardingUrlFromScanResult(scanResult) {
  const rawPath = String(scanResult && scanResult.path || '').trim();
  const queryIndex = rawPath.indexOf('?');
  const route = (queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex))
    .replace(/^\/+/, '');
  const query = queryIndex === -1 ? '' : rawPath.slice(queryIndex + 1);
  if (route !== ONBOARDING_ROUTE || !/(^|&)(token|scene)=[^&]+/.test(query)) return '';
  return `/${ONBOARDING_ROUTE}${rawPath.slice(queryIndex)}`;
}

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function formatMonthDayTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${date} ${hours}:${mins}`;
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function stageTagClass(stageKey) {
  if (['design_published', 'converted'].includes(stageKey)) return 'design-ready';
  if (['survey_completed', 'appointment_confirmed'].includes(stageKey)) return 'settled';
  return 'default-tag';
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    exitingId: '',
    error: '',
    memberships: [],
    selectedMembershipId: '',
    selectedEnterpriseName: '',
    switchingMembershipId: '',
    userName: '',
    todayScans: 0,
    totalClients: 0,
    signedCount: 0,
    pendingCount: 0,
    progressCount: 0,
    milestones: [],
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },

  async onShow() {
    if (this.data.selectedMembershipId) await this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-memberships', 'GET');
      const memberships = (result.data || []).filter((item) => item.status === 'active');
      const app = typeof getApp === 'function' ? getApp() : null;
      const signedMembershipId = String(
        app && app.globalData && app.globalData.bootstrap && app.globalData.bootstrap.current
          && app.globalData.bootstrap.current.context && app.globalData.bootstrap.current.context.referrerMembershipId
          || ''
      );
      const selectedMembershipId = memberships.some((item) => item.id === signedMembershipId)
        ? signedMembershipId
        : memberships.some((item) => item.id === this.data.selectedMembershipId)
          ? this.data.selectedMembershipId
          : (memberships[0] && memberships[0].id) || '';

      const selected = memberships.find((item) => item.id === selectedMembershipId);
      const selectedEnterpriseName = selected ? selected.enterpriseName : '';

      const userInfo = (app && app.globalData && app.globalData.userInfo)
        || (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' ? wx.getStorageSync('userInfo') : null)
        || {};
      const userName = userInfo.displayName || userInfo.name || (userInfo.phone ? `用户${userInfo.phone.slice(-4)}` : '推广人');

      let todayScans = 0;
      let totalClients = 0;
      let signedCount = 0;
      let pendingCount = 0;
      let progressCount = 0;
      let milestones = [];

      if (selectedMembershipId) {
        try {
          const [progressRes, earningsRes] = await Promise.all([
            api.request('/miniprogram/referrer-progress', 'GET').catch(() => null),
            api.request('/miniprogram/referrer-earnings', 'GET').catch(() => null),
          ]);

          const progressItems = (progressRes && progressRes.data && Array.isArray(progressRes.data.items)) ? progressRes.data.items : [];
          const earningsItems = (earningsRes && earningsRes.data && Array.isArray(earningsRes.data.items)) ? earningsRes.data.items : [];
          const earningsPayload = (earningsRes && earningsRes.data) || {};

          totalClients = progressItems.length;
          progressCount = progressItems.length;
          todayScans = progressItems.filter((item) => isToday(item.updatedAt) || isToday(item.convertedAt)).length;
          signedCount = progressItems.filter((item) => item.stage && item.stage.key === 'converted').length;

          pendingCount = Number(earningsPayload.payableCount);
          if (!Number.isFinite(pendingCount)) {
            pendingCount = earningsItems.filter((item) => item.status === 'payable').length;
          }

          const earningsByCustomer = new Map();
          for (const earn of earningsItems) {
            if (earn.customerLabel && !earningsByCustomer.has(earn.customerLabel)) {
              earningsByCustomer.set(earn.customerLabel, earn);
            }
          }

          milestones = progressItems.slice(0, 5).map((item) => {
            const earn = earningsByCustomer.get(item.customerLabel);
            let rewardLabel = '';
            let rewardClass = '';
            if (earn) {
              if (earn.status === 'paid') {
                rewardLabel = '已发放';
                rewardClass = 'paid';
              } else if (earn.status === 'payable') {
                rewardLabel = '待发放';
                rewardClass = 'payable';
              }
            }

            const stageKey = (item.stage && item.stage.key) || 'claimed';
            const stageLabel = (item.stage && item.stage.label) || '新线索';
            const timeStr = formatMonthDayTime(item.updatedAt);
            const desc = `${timeStr ? timeStr + ' · ' : ''}${item.stage && item.stage.nextAction ? item.stage.nextAction : '跟进中'}`;

            return {
              id: item.id,
              customerLabel: item.customerLabel,
              stageKey,
              stageLabel,
              stageClass: stageTagClass(stageKey),
              rewardLabel,
              rewardClass,
              desc,
            };
          });
        } catch (metricsErr) {
          console.warn('Failed to load promoter metrics', metricsErr);
        }
      }

      this.setData({
        memberships,
        selectedMembershipId,
        selectedEnterpriseName,
        userName,
        todayScans,
        totalClients,
        signedCount,
        pendingCount,
        progressCount,
        milestones,
      });
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取推广企业' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async selectMembership(event) {
    const membershipId = String(event.currentTarget.dataset.id || '');
    const membership = this.data.memberships.find((item) => item.id === membershipId);
    if (!membership || membershipId === this.data.selectedMembershipId || this.data.switchingMembershipId) return;

    const app = typeof getApp === 'function' ? getApp() : null;
    const oldToken = app && app.globalData && app.globalData.token;
    const oldUserInfo = app && app.globalData && app.globalData.userInfo;
    const oldBootstrap = app && app.globalData && app.globalData.bootstrap;
    this.setData({ switchingMembershipId: membershipId });
    try {
      const switched = await api.request('/miniprogram/identity-contexts/switch', 'POST', {
        mode: 'referrer',
        enterpriseId: membership.enterpriseId,
        referrerMembershipId: membership.id,
      });
      if (!switched.token) throw new Error('企业身份刷新失败');

      if (app && app.globalData) app.globalData.token = switched.token;
      wx.setStorageSync('token', switched.token);
      const refreshed = await api.request('/auth/miniprogram', 'POST', { type: 'refresh', token: switched.token });
      if (!refreshed.token || !refreshed.user) throw new Error('企业会话刷新失败');
      if (app && app.globalData) {
        app.globalData.token = refreshed.token;
        app.globalData.userInfo = refreshed.user;
        app.globalData.openid = refreshed.openid || refreshed.user.openid || null;
        app.globalData.sessionHydrated = false;
        app.globalData.bootstrap = null;
      }
      wx.setStorageSync('token', refreshed.token);
      wx.setStorageSync('userInfo', refreshed.user);
      if (refreshed.openid) wx.setStorageSync('openid', refreshed.openid);
      if (app && typeof app.hydrateStoredSession === 'function') await app.hydrateStoredSession();
      this.setData({
        selectedMembershipId: membershipId,
        selectedEnterpriseName: membership.enterpriseName,
      });
      wx.showToast({ title: '已切换推广企业', icon: 'success' });
    } catch (error) {
      if (app && app.globalData) {
        app.globalData.token = oldToken;
        app.globalData.userInfo = oldUserInfo;
        app.globalData.bootstrap = oldBootstrap;
      }
      if (oldToken) wx.setStorageSync('token', oldToken);
      wx.showToast({ title: error.message || error.error || '切换失败，请重试', icon: 'none' });
    } finally {
      this.setData({ switchingMembershipId: '' });
    }
  },

  showServiceCode() {
    const membershipId = this.data.selectedMembershipId;
    if (!membershipId) return;
    wx.navigateTo({
      url: `/packages/business/promotion-service-code/promotion-service-code?membershipId=${encodeURIComponent(membershipId)}`,
    });
  },

  openProgress() {
    wx.navigateTo({ url: '/packages/business/referrer-progress/referrer-progress' });
  },

  openEarnings() {
    wx.navigateTo({ url: '/packages/business/referrer-earnings/referrer-earnings' });
  },

  onAddEnterprise() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (result) => {
        const url = onboardingUrlFromScanResult(result);
        if (!url) {
          wx.showToast({ title: '请扫描企业提供的入驻码', icon: 'none' });
          return;
        }
        wx.navigateTo({
          url,
          fail: () => wx.showToast({ title: '无法打开入驻页，请重新扫码', icon: 'none' })
        });
      },
      fail: (error) => {
        if (String(error && error.errMsg || '').includes('cancel')) return;
        wx.showToast({ title: '扫码失败，请确认二维码有效', icon: 'none' });
      }
    });
  },

  leaveSelectedEnterprise() {
    const membershipId = this.data.selectedMembershipId;
    if (!membershipId || this.data.exitingId) return;
    const selected = this.data.memberships.find((item) => item.id === membershipId);
    wx.showModal({
      title: '退出推广企业',
      content: `退出后将无法继续展示${selected && selected.enterpriseName ? '该企业的' : ''}服务码，历史服务记录不受影响。`,
      confirmText: '确认退出',
      confirmColor: '#D14343',
      success: async (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ exitingId: membershipId });
        try {
          const result = await api.request(
            `/miniprogram/referrer-memberships/${encodeURIComponent(membershipId)}`,
            'DELETE'
          );
          if (result.token) {
            const app = typeof getApp === 'function' ? getApp() : null;
            if (app && app.globalData) {
              app.globalData.token = result.token;
              app.globalData.sessionHydrated = false;
              app.globalData.bootstrap = null;
            }
            wx.setStorageSync('token', result.token);
            if (app && typeof app.hydrateStoredSession === 'function') {
              await app.hydrateStoredSession();
            }
            if (app && app.globalData && app.globalData.sessionRecovery) {
              throw new Error('身份已失效，请重新选择');
            }
            wx.showToast({ title: '已退出推广企业', icon: 'success' });
            const identity = {
              ...((app && app.globalData && app.globalData.userInfo) || {}),
              ...((app && app.globalData && app.globalData.bootstrap && app.globalData.bootstrap.current)
                || result.context
                || {})
            };
            if (roleForIdentity(identity) !== 'referrer') {
              navigateToRoleLanding(identity);
              return;
            }
          } else {
            wx.showToast({ title: '已退出推广企业', icon: 'success' });
          }
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message || error.error || '退出失败，请重试', icon: 'none' });
        } finally {
          this.setData({ exitingId: '' });
        }
      },
    });
  },
});
