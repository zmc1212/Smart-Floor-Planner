const { openAIDesignTab } = require('../../../utils/aiDesignNavigation.js');
const { pendingAiEntryVisibility } = require('../../../utils/ai-entries.js');

Page({
  async onLoad(options) {
    const pending = pendingAiEntryVisibility();
    if (pending) await pending;
    openAIDesignTab(options);
  },
});
