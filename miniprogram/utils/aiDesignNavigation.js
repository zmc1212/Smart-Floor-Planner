const AI_DESIGN_TAB_URL = '/pages/ai-design/ai-design';
const CONTEXT_KEYS = ['floorPlanId', 'leadId', 'roomId', 'targetScope', 'workflowId'];
const { ensureAIDesignAccess } = require('./aiDesignAccess.js');

function normalizeAIDesignContext(options = {}) {
  const context = CONTEXT_KEYS.reduce((result, key) => {
    if (options[key]) result[key] = String(options[key]);
    return result;
  }, {});

  if (!context.targetScope) {
    context.targetScope = context.roomId
      ? 'single_room'
      : context.floorPlanId
        ? 'whole_floor_plan'
        : '';
  }

  return context;
}

function openAIDesignTab(options = {}) {
  if (!ensureAIDesignAccess()) return false;

  const app = getApp();
  const context = normalizeAIDesignContext(options);
  const hasContext = CONTEXT_KEYS.some((key) => context[key]);

  if (hasContext && app && app.globalData) {
    app.globalData.pendingAIDesignContext = context;
  }

  wx.switchTab({
    url: AI_DESIGN_TAB_URL,
    fail(error) {
      if (hasContext && app && app.globalData && app.globalData.pendingAIDesignContext === context) {
        app.globalData.pendingAIDesignContext = null;
      }
      console.error('Open AI Design tab failed:', error);
      wx.showToast({ title: '打开 AI 设计失败', icon: 'none' });
    },
  });

  return true;
}

function consumeAIDesignContext() {
  const app = getApp();
  if (!app || !app.globalData || !app.globalData.pendingAIDesignContext) return null;

  const context = app.globalData.pendingAIDesignContext;
  app.globalData.pendingAIDesignContext = null;
  return normalizeAIDesignContext(context);
}

module.exports = {
  AI_DESIGN_TAB_URL,
  consumeAIDesignContext,
  normalizeAIDesignContext,
  openAIDesignTab,
};
