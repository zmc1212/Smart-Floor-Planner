const { openAIDesignTab } = require('../../utils/aiDesignNavigation.js');

Page({
  onLoad(options) {
    openAIDesignTab(options);
  },
});
