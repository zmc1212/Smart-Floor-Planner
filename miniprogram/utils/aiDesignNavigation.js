const AI_DESIGN_TAB_URL = '/pages/ai-design/ai-design';
const CONTEXT_KEYS = ['floorPlanId', 'leadId', 'roomId', 'targetScope', 'workflowId'];
const OPEN_AI_DESIGN_RESET_MS = 800;
const { ensureAIDesignAccess } = require('./aiDesignAccess.js');

let openingAIDesignEntry = false;

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

function shouldOpenSchemeStudio(options = {}) {
  const context = normalizeAIDesignContext(options);
  return !!context.leadId;
}

function buildSchemeStudioUrl(options = {}) {
  const context = normalizeAIDesignContext(options);
  const query = ['leadId', 'workflowId', 'floorPlanId']
    .filter((key) => context[key])
    .map((key) => `${key}=${encodeURIComponent(context[key])}`)
    .join('&');
  return `/packages/ai-workflow/scheme-studio/scheme-studio?${query}`;
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

function openSchemeStudio(options = {}) {
  if (openingAIDesignEntry) return false;
  if (!ensureAIDesignAccess()) return false;

  const context = normalizeAIDesignContext(options);
  if (!context.leadId) {
    wx.showToast({ title: '缺少客户线索', icon: 'none' });
    return false;
  }

  openingAIDesignEntry = true;
  const url = buildSchemeStudioUrl(context);
  const navigate = options.redirect ? wx.redirectTo : wx.navigateTo;
  navigate({
    url,
    fail(error) {
      openingAIDesignEntry = false;
      console.error('Open scheme studio failed:', error);
      wx.showToast({ title: '打开方案工作台失败', icon: 'none' });
    },
    complete: () => {
      setTimeout(() => {
        openingAIDesignEntry = false;
      }, OPEN_AI_DESIGN_RESET_MS);
    },
  });

  return true;
}

/** Prefer scheme-studio when a lead is known; otherwise open the Design tab. */
function openAIDesignEntry(options = {}) {
  if (openingAIDesignEntry) return false;
  if (shouldOpenSchemeStudio(options)) {
    return openSchemeStudio(options);
  }
  openingAIDesignEntry = true;
  const opened = openAIDesignTab(options);
  if (!opened) {
    openingAIDesignEntry = false;
    return false;
  }
  setTimeout(() => {
    openingAIDesignEntry = false;
  }, OPEN_AI_DESIGN_RESET_MS);
  return true;
}

module.exports = {
  AI_DESIGN_TAB_URL,
  buildSchemeStudioUrl,
  consumeAIDesignContext,
  normalizeAIDesignContext,
  openAIDesignEntry,
  openAIDesignTab,
  openSchemeStudio,
  shouldOpenSchemeStudio,
};
