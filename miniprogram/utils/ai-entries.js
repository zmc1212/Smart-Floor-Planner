function appState() {
  return typeof getApp === 'function' ? getApp()?.globalData : null;
}

function aiEntriesEnabled(globalData = appState()) {
  return globalData?.aiEntriesEnabled === true && globalData.aiEntriesChecking !== true;
}

function pendingAiEntryVisibility() {
  return appState()?.aiEntriesRequest;
}

function customerHomeTab(globalData) {
  return aiEntriesEnabled(globalData) ? globalData.customerTab || 'xiaok' : 'service';
}

function staffHomeTab(globalData) {
  return aiEntriesEnabled(globalData) ? globalData.siteWorkbenchTab || 'workbench' : 'workbench';
}

function isAIDesignRoute(route) {
  const path = String(route || '').replace(/^\/+/, '').split('?')[0];
  return path === 'pages/ai-design/ai-design' || path.startsWith('packages/ai-workflow/');
}

function syncAiEntryVisibility() {
  this.setData({ aiEntriesEnabled: aiEntriesEnabled() });
}

module.exports = { aiEntriesEnabled, pendingAiEntryVisibility, customerHomeTab, staffHomeTab, isAIDesignRoute, syncAiEntryVisibility };
