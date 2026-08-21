const TEMPLATE_CONFIG_STORAGE_KEY = 'miniprogramNotificationTemplatesV2';
const TEMPLATE_ORDER = [
  'workflow_todo',
  'lead_assignment',
  'new_lead',
  'measurement_appointment',
  'design_published',
  'enterprise_join_result'
];
const ROLE_SUBSCRIBE_KINDS = Object.freeze({
  customer: ['measurement_appointment', 'design_published'],
  designer: ['lead_assignment', 'measurement_appointment', 'workflow_todo'],
  measurer: ['lead_assignment', 'measurement_appointment', 'workflow_todo'],
  enterprise_admin: ['new_lead', 'workflow_todo'],
  referrer: []
});
const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const api = require('./api.js');

function normalizeTemplateConfig(value) {
  if (!value || Number(value.version) !== 2 || !Array.isArray(value.templates)) return null;
  const byType = {};
  value.templates.forEach((template) => {
    if (
      template &&
      TEMPLATE_ORDER.includes(template.type) &&
      typeof template.templateId === 'string' &&
      TEMPLATE_ID_PATTERN.test(template.templateId)
    ) {
      byType[template.type] = {
        type: template.type,
        title: typeof template.title === 'string' ? template.title : '',
        templateId: template.templateId
      };
    }
  });
  if (!TEMPLATE_ORDER.every((type) => byType[type])) return null;
  if (new Set(TEMPLATE_ORDER.map((type) => byType[type].templateId)).size !== TEMPLATE_ORDER.length) {
    return null;
  }
  return {
    version: 2,
    templates: TEMPLATE_ORDER.map((type) => byType[type])
  };
}

function getTemplateConfig() {
  if (!wx.getStorageSync) return null;
  return normalizeTemplateConfig(wx.getStorageSync(TEMPLATE_CONFIG_STORAGE_KEY));
}

function resolveSubscribeRole(explicitRole) {
  if (explicitRole && (ROLE_SUBSCRIBE_KINDS[explicitRole] || explicitRole === 'referrer')) {
    return explicitRole;
  }
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    const bootstrap = app && app.globalData && app.globalData.bootstrap;
    const current = bootstrap && bootstrap.current;
    if (current && current.role && ROLE_SUBSCRIBE_KINDS[current.role]) {
      return current.role;
    }
    if (current && current.mode === 'referrer') return 'referrer';
    if (current && current.mode === 'customer') return 'customer';
    if (current && current.mode === 'staff' && current.context && current.context.staffRole) {
      return current.context.staffRole;
    }
  } catch (error) {
    console.warn('Unable to resolve notification subscribe role', error);
  }
  return 'customer';
}

function getSubscribeKindsForRole(role) {
  const resolved = resolveSubscribeRole(role);
  return ROLE_SUBSCRIBE_KINDS[resolved] || [];
}

function getTemplateIds(role) {
  const config = getTemplateConfig();
  if (!config) return [];
  const kinds = getSubscribeKindsForRole(role);
  if (!kinds.length) return [];
  const byType = {};
  config.templates.forEach((template) => {
    byType[template.type] = template.templateId;
  });
  return kinds.map((kind) => byType[kind]).filter(Boolean);
}

async function refreshTemplateConfig() {
  try {
    const result = await api.request('/miniprogram/notification-template', 'GET');
    const config = normalizeTemplateConfig(result && result.data);
    if (config) {
      if (wx.setStorageSync) wx.setStorageSync(TEMPLATE_CONFIG_STORAGE_KEY, config);
      return config;
    }
    console.warn('Mini Program notification template response is incomplete');
  } catch (error) {
    console.warn('Unable to refresh Mini Program notification templates', error);
  }
  return getTemplateConfig();
}

function emptySubscriptionResult(templateIds, supported = true) {
  return {
    supported,
    templateIds,
    accepted: [],
    rejected: [],
    banned: [],
    filtered: [],
    unavailable: []
  };
}

function categorizeSubscriptionResult(templateIds, response) {
  const result = emptySubscriptionResult(templateIds);
  templateIds.forEach((templateId) => {
    const state = response && response[templateId];
    if (state === 'accept') result.accepted.push(templateId);
    else if (state === 'reject') result.rejected.push(templateId);
    else if (state === 'ban') result.banned.push(templateId);
    else if (state === 'filter') result.filtered.push(templateId);
    else result.unavailable.push(templateId);
  });
  return result;
}

function resolveTemplateIdsForKinds(config, kinds) {
  if (!config || !Array.isArray(kinds) || !kinds.length) return [];
  return kinds
    .map((kind) => {
      const match = config.templates.find((template) => template.type === kind);
      return match && match.templateId;
    })
    .filter(Boolean);
}

async function requestSubscribeMessageForTemplateIds(templateIds, options = {}) {
  const quiet = Boolean(options && options.quiet);
  if (!wx.requestSubscribeMessage) {
    if (!quiet) wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
    return emptySubscriptionResult(templateIds, false);
  }
  if (!templateIds.length) {
    if (!quiet) wx.showToast({ title: '通知配置暂不可用，请稍后重试', icon: 'none' });
    return emptySubscriptionResult([]);
  }
  if (templateIds.length > 3) {
    console.warn('Subscribe template request exceeds WeChat limit', templateIds.length);
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: templateIds.slice(0, 3),
      success(response) {
        const requested = templateIds.slice(0, 3);
        const result = categorizeSubscriptionResult(requested, response);
        if (!quiet) {
          if (result.accepted.length === requested.length) {
            wx.showToast({ title: '通知已开启', icon: 'success' });
          } else if (result.accepted.length > 0) {
            wx.showToast({ title: `已开启 ${result.accepted.length}/${requested.length} 项`, icon: 'none' });
          } else {
            wx.showToast({ title: '未开启通知', icon: 'none' });
          }
        }
        resolve(result);
      },
      fail(error) {
        if (!quiet && error.errCode === 20004) {
          wx.showModal({
            title: '开启通知',
            content: '请在设置中开启消息通知，否则无法接收任务提醒。',
            confirmText: '去开启',
            success(modalResult) {
              if (modalResult.confirm) wx.openSetting();
            }
          });
        }
        if (quiet) {
          resolve(emptySubscriptionResult(templateIds));
          return;
        }
        reject(error);
      }
    });
  });
}

async function requestNotification(options = {}) {
  const role = resolveSubscribeRole(options && options.role);
  const kinds = getSubscribeKindsForRole(role);
  if (!kinds.length) {
    wx.showToast({ title: '当前身份无需订阅通知', icon: 'none' });
    return emptySubscriptionResult([]);
  }

  const config = await refreshTemplateConfig();
  const templateIds = resolveTemplateIdsForKinds(config, kinds);
  return requestSubscribeMessageForTemplateIds(templateIds, options);
}

async function requestSubscribeKinds(kinds, options = {}) {
  const requestedKinds = Array.isArray(kinds)
    ? kinds.filter((kind) => TEMPLATE_ORDER.includes(kind))
    : [];
  if (!requestedKinds.length) {
    return emptySubscriptionResult([]);
  }
  const config = await refreshTemplateConfig();
  const templateIds = resolveTemplateIdsForKinds(config, requestedKinds);
  return requestSubscribeMessageForTemplateIds(templateIds, options);
}

module.exports = {
  TEMPLATE_CONFIG_STORAGE_KEY,
  TEMPLATE_ORDER,
  ROLE_SUBSCRIBE_KINDS,
  requestNotification,
  requestSubscribeKinds,
  getTemplateConfig,
  getTemplateIds,
  getSubscribeKindsForRole,
  resolveSubscribeRole,
  refreshTemplateConfig,
  normalizeTemplateConfig,
  categorizeSubscriptionResult
};
