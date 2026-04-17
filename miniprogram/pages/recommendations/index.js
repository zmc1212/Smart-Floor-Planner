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

  onLoad(options) {
    this.fetchRecommendations();
  },

  async fetchRecommendations() {
    try {
      this.setData({ loading: true, error: null });

      // TODO: 替换为真实的API调用
      const mockRecommendations = [
        {
          id: 'modern-simple',
          name: '现代简约',
          description: '简洁明快的设计风格，功能至上',
          estimatedBudget: { min: 150000, max: 250000 },
          imageUrl: '/images/modern-simple.jpg',
          features: ['储物空间优化', '开放式布局', '智能家居'],
          matchScore: 0.85
        },
        {
          id: 'cream-style',
          name: '奶油风',
          category: 'nordic',
          description: '温馨舒适的北欧风格',
          estimatedBudget: { min: 180000, max: 300000 },
          imageUrl: '/images/cream-style.jpg',
          features: ['温馨色调', '自然材质', '舒适布局'],
          matchScore: 0.92
        },
        {
          id: 'new-chinese',
          name: '新中式',
          category: 'chinese',
          description: '传统与现代的完美融合',
          estimatedBudget: { min: 220000, max: 400000 },
          imageUrl: '/images/new-chinese.jpg',
          features: ['传统文化元素', '现代功能', '典雅设计'],
          matchScore: 0.78
        },
        {
          id: 'luxury-minimal',
          name: '轻奢风',
          category: 'luxury',
          description: '低调奢华，精致生活',
          estimatedBudget: { min: 300000, max: 600000 },
          imageUrl: '/images/luxury-minimal.jpg',
          features: ['高级材质', '精致细节', '智能化'],
          matchScore: 0.88
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
      // 取消选择
      this.setData({ selectedStyle: null });
      // TODO: 调用API取消选择
    } else {
      // 选择新风格
      this.setData({ selectedStyle: styleId });
      // TODO: 调用API保存选择
      wx.showToast({
        title: '已选择该风格',
        icon: 'success'
      });

      // 记录用户交互
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

      // 记录下载事件
      this.trackUserInteraction('pdf_download', styleId, { downloadTime: Date.now() });

      // TODO: 实际实现PDF下载逻辑
    }, 2000);
  },

  onShare(e) {
    const styleId = e.currentTarget.dataset.styleId || this.data.selectedStyle;

    if (!styleId) return;

    // 记录分享事件
    this.trackUserInteraction('share', styleId, { platform: 'wechat' });

    wx.showActionSheet({
      itemList: ['分享到朋友圈', '分享给好友'],
      success(res) {
        if (res.tapIndex === 0) {
          // 分享到朋友圈
          wx.shareAppMessage({
            title: '我用智能量房大师获得了装修推荐！你也来试试？',
            path: `/pages/recommendations/index?selected=${styleId}`,
            imageUrl: '/images/share-preview.jpg'
          });
        } else {
          // 分享给好友
          wx.shareToChat({
            url: `/pages/recommendations/index?selected=${styleId}`,
            title: '智能装修推荐',
            imageUrl: '/images/share-preview.jpg'
          });
        }
      }
    });
  },

  trackUserInteraction(type, targetId, metadata = {}) {
    // TODO: 集成真实的埋点系统
    console.log('用户交互:', type, targetId, metadata);

    // 示例埋点数据
    const eventData = {
      userId: 'current-user', // TODO: 从全局状态获取真实用户ID
      sessionId: wx.getStorageSync('sessionId') || 'temp-session',
      timestamp: Date.now(),
      eventType: `user_${type}`,
      properties: {
        targetId,
        ...metadata
      }
    };

    // TODO: 发送到分析平台
    // analytics.track(eventData.eventType, eventData.properties);
  },

  onReachBottom() {
    // 加载更多推荐
    this.loadMoreRecommendations();
  },

  loadMoreRecommendations() {
    // TODO: 实现分页加载逻辑
    console.log('加载更多推荐...');
  },

  onShareAppMessage() {
    const styleId = this.data.selectedStyle;

    return {
      title: styleId ? `我用智能量房大师选择了${this.getStyleName(styleId)}风格！你也来试试？` : '我用智能量房大师获得了3套装修方案！你也来试试？',
      path: `/pages/recommendations/index${styleId ? `?selected=${styleId}` : ''}`,
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
    return styles[styleId] || '精美';
  }
});