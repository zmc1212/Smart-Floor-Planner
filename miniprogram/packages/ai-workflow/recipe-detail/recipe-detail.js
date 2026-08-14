const aiService = require('../../../utils/aiDesignService.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../../utils/aiDesignAccess.js');

Page({
  data: {
    loading: true,
    error: '',
    recipe: null,
    inputMode: 'floor_plan',
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    floorPlanPrice: 10,
    photoPrice: 10,
  },

  onLoad(options) {
    if (!canAccessAIDesign()) {
      showAIDesignAccessDenied();
      wx.navigateBack();
      return;
    }
    this.syncNavigationMetrics();
    this.setData({
      recipeId: options.id || '',
      inputMode: options.inputMode === 'photo' ? 'photo' : 'floor_plan',
    });
    this.loadRecipe();
  },

  syncNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let menuRect = null;
    try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
    const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
    const navigationTop = Number(menuRect && menuRect.top ? menuRect.top : statusBarHeight + 6);
    const navigationHeight = Number(menuRect && menuRect.height ? menuRect.height : 32);
    const menuLeft = Number(menuRect && menuRect.left ? menuRect.left : windowInfo.windowWidth);
    this.setData({
      navigationTop,
      navigationHeight,
      navigationRight: Math.max(92, Number(windowInfo.windowWidth || 390) - menuLeft + 12),
    });
  },

  async loadRecipe() {
    if (!this.data.recipeId) {
      this.setData({ loading: false, error: '装修配方不存在或已下架' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const [recipe, capabilities] = await Promise.all([
        aiService.getRecipe(this.data.recipeId),
        aiService.loadCapabilities(),
      ]);
      const floorMode = (capabilities.modes || []).find((item) => item.key === 'floor_plan_render');
      const photoMode = (capabilities.modes || []).find((item) => item.key === 'style_transform');
      const inputMode = (recipe.inputTypes || []).includes(this.data.inputMode)
        ? this.data.inputMode
        : (recipe.inputTypes || [])[0] || 'floor_plan';
      this.setData({
        recipe,
        inputMode,
        floorPlanPrice: Number(floorMode && floorMode.credits || 10),
        photoPrice: Number(photoMode && photoMode.credits || 10),
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false, error: error.error || error.message || '装修配方加载失败' });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  retry() {
    this.loadRecipe();
  },

  selectInputMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!(this.data.recipe.inputTypes || []).includes(mode)) return;
    this.setData({ inputMode: mode });
  },

  useRecipe() {
    const recipe = this.data.recipe;
    if (!recipe) return;
    const query = [
      `recipeId=${encodeURIComponent(recipe.id)}`,
      `inputMode=${encodeURIComponent(this.data.inputMode)}`,
    ].join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/recipe-project/recipe-project?${query}` });
  },
});
