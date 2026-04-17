// 小程序埋点服务

class AnalyticsService {
  constructor() {
    this.sessionId = this.generateSessionId();
    this.userId = wx.getStorageSync('userId') || null;
    this.isEnabled = true;

    // 初始化会话ID
    if (!wx.getStorageSync('sessionId')) {
      wx.setStorageSync('sessionId', this.sessionId);
    }
  }

  generateSessionId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  setUserId(userId) {
    this.userId = userId;
    wx.setStorageSync('userId', userId);
  }

  track(eventType, properties = {}) {
    if (!this.isEnabled) return;

    const eventData = {
      sessionId: this.sessionId,
      userId: this.userId,
      timestamp: Date.now(),
      eventType,
      properties: {
        ...properties,
        page: getCurrentPages()[getCurrentPages().length - 1].route,
        referrer: wx.getStorageSync('referrer') || ''
      }
    };

    console.log('埋点数据:', eventData);

    // TODO: 发送数据到分析平台
    // 这里可以集成Google Analytics、百度统计、或自建分析服务
    this.sendToAnalytics(eventData);
  }

  sendToAnalytics(eventData) {
    // 示例实现 - 实际项目中应该发送到真实的分析平台
    wx.request({
      url: 'https://api.example.com/analytics',
      method: 'POST',
      data: eventData,
      success: (res) => {
        console.log('埋点发送成功:', res.data);
      },
      fail: (err) => {
        console.error('埋点发送失败:', err);
      }
    });
  }

  // 页面相关埋点
  trackPageView(pageName) {
    this.track('page_view', { pageName });
  }

  trackPageLeave(pageName) {
    this.track('page_leave', { pageName });
  }

  // 推荐相关埋点
  trackRecommendationView(recommendationId, position = 0) {
    this.track('recommendation_view', {
      recommendationId,
      position,
      source: 'dashboard'
    });
  }

  trackPdfDownload(styleId, downloadTime) {
    this.track('pdf_download', {
      styleId,
      downloadTime,
      sessionId: this.sessionId
    });
  }

  trackSocialShare(shareType, platform, targetId) {
    this.track('social_share', {
      shareType,
      platform,
      targetId
    });
  }

  trackUserAction(action, metadata = {}) {
    this.track('user_action', {
      action,
      ...metadata
    });
  }

  // 错误监控
  trackError(errorMessage, errorStack) {
    this.track('error', {
      errorMessage,
      errorStack,
      userAgent: wx.getSystemInfoSync()
    });
  }

  // 性能监控
  trackPerformance(metric, value, unit = 'ms') {
    this.track('performance_metric', {
      metric,
      value,
      unit,
      timestamp: Date.now()
    });
  }
}

// 创建全局实例
const analytics = new AnalyticsService();

module.exports = {
  analytics
};