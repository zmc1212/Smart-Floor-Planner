const TEMPLATE_CONFIG_STORAGE_KEY = 'miniprogramNotificationTemplatesV2';
const TEMPLATE_ORDER = [
  'workflow_todo',
  'lead_assignment',
  'new_lead',
  'measurement_appointment'
];
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

function getTemplateIds() {
  const config = getTemplateConfig();
  return config ? config.templates.map((template) => template.templateId) : [];
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

async function requestNotification() {
  const config = await refreshTemplateConfig();
  const templateIds = config ? config.templates.map((template) => template.templateId) : [];
  if (!wx.requestSubscribeMessage) {
    wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
    return emptySubscriptionResult(templateIds, false);
  }
  if (!templateIds.length) {
    wx.showToast({ title: '通知配置暂不可用，请稍后重试', icon: 'none' });
    return emptySubscriptionResult([]);
  }

  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: templateIds,
      success(response) {
        const result = categorizeSubscriptionResult(templateIds, response);
        if (result.accepted.length === templateIds.length) {
          wx.showToast({ title: '通知已开启', icon: 'success' });
        } else if (result.accepted.length > 0) {
          wx.showToast({ title: `已开启 ${result.accepted.length}/${templateIds.length} 项`, icon: 'none' });
        } else {
          wx.showToast({ title: '未开启通知', icon: 'none' });
        }
        resolve(result);
      },
      fail(error) {
        if (error.errCode === 20004) {
          wx.showModal({
            title: '开启通知',
            content: '请在设置中开启消息通知，否则无法接收任务提醒。',
            confirmText: '去开启',
            success(modalResult) {
              if (modalResult.confirm) wx.openSetting();
            }
          });
        }
        reject(error);
      }
    });
  });
}

module.exports = {
  TEMPLATE_CONFIG_STORAGE_KEY,
  TEMPLATE_ORDER,
  requestNotification,
  getTemplateConfig,
  getTemplateIds,
  refreshTemplateConfig,
  normalizeTemplateConfig,
  categorizeSubscriptionResult
};
