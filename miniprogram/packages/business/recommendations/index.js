Page({
  data: {
    recommendations: [],
    selectedStyle: null,
    loading: true,
    error: null,
    progressStages: [
      { id: 'measurement', title: '户型测量', description: '完成房间尺寸测量' },
      { id: 'style-selection', title: '风格选择', description: '选择喜欢的装修风格' },
      { id: 'ai-render', title: 'AI效果图', description: '生成个性化设计方案' },
      { id: 'lead-capture', title: '获取报价', description: '留下联系方式获取详细报价' }
    ],
    currentStep: 2,
    completedSteps: ['measurement', 'style-selection']
  },

  onLoad() {
    this.fetchRecommendations();
  },

  async fetchRecommendations() {
    try {
      this.setData({ loading: true, error: null });

      const mockRecommendations = [
        {
          id: 'modern-simple',
          name: '现代简约',
          description: '简洁明快的设计风格，功能至上。',
          estimatedBudget: { min: 150000, max: 250000 },
          budgetLabel: '¥150,000 - ¥250,000',
          imageUrl: '/images/share-preview.jpg',
          features: ['储物优化', '开放布局', '智能家居'],
          matchScore: 0.85,
          matchPercent: 85
        },
        {
          id: 'cream-style',
          name: '奶油风',
          category: 'nordic',
          description: '温暖舒适的浅色空间方案。',
          estimatedBudget: { min: 180000, max: 300000 },
          budgetLabel: '¥180,000 - ¥300,000',
          imageUrl: '/images/share-preview.jpg',
          features: ['温柔色调', '自然材质', '舒适布局'],
          matchScore: 0.92,
          matchPercent: 92
        },
        {
          id: 'new-chinese',
          name: '新中式',
          category: 'chinese',
          description: '传统气质与现代功能融合。',
          estimatedBudget: { min: 220000, max: 400000 },
          budgetLabel: '¥220,000 - ¥400,000',
          imageUrl: '/images/share-preview.jpg',
          features: ['文化元素', '现代功能', '典雅设计'],
          matchScore: 0.78,
          matchPercent: 78
        },
        {
          id: 'luxury-minimal',
          name: '轻奢风',
          category: 'luxury',
          description: '低调精致，强调材质与细节。',
          estimatedBudget: { min: 300000, max: 600000 },
          budgetLabel: '¥300,000 - ¥600,000',
          imageUrl: '/images/share-preview.jpg',
          features: ['高级材质', '精致细节', '智能化'],
          matchScore: 0.88,
          matchPercent: 88
        }
      ];

      this.setData({
        recommendations: mockRecommendations,
        loading: false
      });
    } catch (error) {
      console.error('获取推荐失败:', error);
      this.setData({
        error: '获取推荐方案失败，请稍后重试',
        loading: false
      });
    }
  },

  onStyleSelect(e) {
    const styleId = e.currentTarget.dataset.styleId;
    const currentSelected = this.data.selectedStyle;

    if (currentSelected === styleId) {
      this.setData({ selectedStyle: null });
    } else {
      this.setData({ selectedStyle: styleId });
      wx.showToast({
        title: '已选择该风格',
        icon: 'success'
      });
      this.trackUserInteraction('style_select', styleId, { position: 0 });
    }
  },

  onDownloadPdf(e) {
    const styleId = e.currentTarget.dataset.styleId;

    wx.showLoading({ title: '正在生成PDF...' });

    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: 'PDF下载成功',
        icon: 'success'
      });
      this.trackUserInteraction('pdf_download', styleId, { downloadTime: Date.now() });
    }, 2000);
  },

  onShare(e) {
    const styleId = e.currentTarget.dataset.styleId || this.data.selectedStyle;

    if (!styleId) return;

    this.trackUserInteraction('share', styleId, { platform: 'wechat' });

    wx.showActionSheet({
      itemList: ['分享给朋友', '保存方案海报'],
      success: () => {}
    });
  },

  trackUserInteraction(type, targetId, metadata = {}) {
    console.log('用户交互:', type, targetId, metadata);
  },

  onReachBottom() {
    this.loadMoreRecommendations();
  },

  loadMoreRecommendations() {
    console.log('加载更多推荐...');
  },

  onShareAppMessage() {
    const styleId = this.data.selectedStyle;

    return {
      title: styleId ? `我选择了${this.getStyleName(styleId)}风格，你也来试试` : '智能量房大师为我推荐了装修方案',
      path: `/packages/business/recommendations/index${styleId ? `?selected=${styleId}` : ''}`,
      imageUrl: '/images/share-preview.jpg'
    };
  },

  getStyleName(styleId) {
    const styles = {
      'modern-simple': '现代简约',
      'cream-style': '奶油风',
      'new-chinese': '新中式',
      'luxury-minimal': '轻奢风'
    };
    return styles[styleId] || '精选';
  }
});
