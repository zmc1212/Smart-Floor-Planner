const api = require('../../../utils/api');

const STAGE_LABELS = Object.freeze({
  direction: '风格方案',
  base_render: '全屋效果',
  soft_furnishing: '软装深化',
  conversation: '方案对话',
  proposal_pack: '提案板',
  lighting: '灯光增强',
  perspective_upgrade: '视角升级',
  premium_board: '精装提案',
  tour_board: '漫游分镜',
  cad_detail: 'CAD 深化',
});

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function getAuthToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function fetchProtectedImage(endpoint, cacheKey) {
  const baseUrl = api.getBaseUrls()[0];
  const token = getAuthToken();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${String(baseUrl).replace(/\/+$/, '')}${endpoint}`,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(response) {
        if (response.statusCode !== 200 || !response.data) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const contentType = String(response.header && (response.header['content-type'] || response.header['Content-Type']) || '').toLowerCase();
        const extension = contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : '';
        if (!extension) {
          reject(new Error('图片格式不受支持'));
          return;
        }
        const safeKey = String(cacheKey || 'asset').replace(/[^a-zA-Z0-9_-]/g, '');
        const filePath = `${wx.env.USER_DATA_PATH}/customer-ai-schemes-${safeKey || 'asset'}.${extension}`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success: () => resolve(filePath),
          fail: (error) => reject(error instanceof Error ? error : new Error(error && error.errMsg || '图片临时文件写入失败')),
        });
      },
      fail: (error) => reject(error instanceof Error ? error : new Error(error && error.errMsg || '图片读取失败')),
    });
  });
}

function stageLabel(stageKey) {
  const key = String(stageKey || '').trim();
  return STAGE_LABELS[key] || '效果图';
}

function displayImageCopy(image, schemeTitle, imageIndex, imageCount) {
  const ordinal = Number(imageIndex) + 1;
  const total = Math.max(1, Number(imageCount) || 1);
  const schemeFallback = String(schemeTitle || '').trim();
  // Customer-facing labels only: never surface designer prompts or English stage keys.
  return {
    displayTitle: total > 1 ? `第 ${ordinal} 张效果图` : (schemeFallback || '效果图'),
    displayHint: '点击预览',
  };
}

function formatDeliveryTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 交付`;
}

function formatTimelineTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function styleTagForTitle(title) {
  const cleaned = String(title || '').trim().replace(/^#+/, '');
  if (!cleaned) return '#设计方案';
  return cleaned.startsWith('#') ? cleaned : `#${cleaned}${cleaned.endsWith('风') ? '' : '风'}`;
}

function stripStyleSuffix(title) {
  return String(title || '').trim().replace(/^#+/, '').replace(/风$/, '');
}

function decorateImages(images, schemeTitle) {
  const list = Array.isArray(images) ? images : [];
  return list.map((image, index) => ({
    ...image,
    stageLabel: stageLabel(image && image.stageKey),
    ...displayImageCopy(image, schemeTitle, index, list.length),
    timeLabel: formatTimelineTime(image && image.publishedAt),
    imagePath: '',
    imageState: image && image.imageEndpoint ? 'loading' : 'error',
  }));
}

function decorateSchemes(schemes, leadId, audience) {
  const list = Array.isArray(schemes) ? schemes.slice() : [];
  list.sort((left, right) => {
    const leftTime = new Date(left && left.publishedAt || 0).getTime();
    const rightTime = new Date(right && right.publishedAt || 0).getTime();
    return leftTime - rightTime;
  });
  return list.map((scheme, index) => {
    const title = String(scheme && scheme.title || '设计方案').trim();
    const images = decorateImages(scheme && scheme.images, title).map((image) => ({
      ...image,
      imageEndpoint: image.imageEndpoint
        || (audience === 'customer'
          ? `/miniprogram/customer-projects/${leadId}/published-generations/${image.generationId}/image`
          : `/leads/${leadId}/published-generations/${image.generationId}/image`),
      imageState: (image.imageEndpoint
        || image.generationId)
        ? 'loading'
        : 'error',
    }));
    const imageCount = Number(scheme && scheme.imageCount) || images.length;
    const cover = images.length ? images[images.length - 1] : null;
    return {
      ...scheme,
      id: String(scheme && scheme.id || `scheme-${index}`),
      title,
      chipLabel: `第${index + 1}轮 ${stripStyleSuffix(title)}`,
      roundIndex: index + 1,
      imageCount,
      images,
      cover,
      styleTag: `${styleTagForTitle(title)} · ${imageCount}张`,
      deliveryLabel: formatDeliveryTime((cover && cover.publishedAt) || (scheme && scheme.publishedAt)),
    };
  });
}

function buildHeroTitle(payload, audience) {
  if (audience === 'customer') {
    return String(payload && payload.heroTitle || '').trim() || '我的装修服务';
  }
  const lead = payload || {};
  const community = String(lead.communityName || '').trim();
  const name = String(lead.name || '').trim();
  if (community && name && community !== name) return `${community} · ${name}`;
  return name || community || '客户 AI 方案';
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    leadId: '',
    schemeId: '',
    audience: 'customer',
    loading: true,
    error: '',
    heroTitle: '',
    heroSubtitle: '',
    schemes: [],
    selectedSchemeId: '',
    selectedScheme: null,
    timelineImages: [],
    showSchemeChips: false,
    backLabel: '返回服务档案',
    showShareAction: true,
  },

  onLoad(query) {
    this._assetRequestId = 0;
    const audience = String(query.mode || query.from || 'customer') === 'staff' ? 'staff' : 'customer';
    this.setData({
      ...navigationMetrics(),
      leadId: query.leadId || query.id || '',
      schemeId: query.schemeId || '',
      audience,
      backLabel: audience === 'staff' ? '返回客户详情' : '返回服务档案',
      showShareAction: audience === 'customer',
    });
    this.load();
  },

  onUnload() {
    this._assetRequestId = (this._assetRequestId || 0) + 1;
  },

  async load() {
    if (!this.data.leadId) {
      this.setData({ loading: false, error: '缺少客户项目' });
      return;
    }
    this._assetRequestId = (this._assetRequestId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const audience = this.data.audience;
      const path = audience === 'customer'
        ? `/miniprogram/customer-projects/${encodeURIComponent(this.data.leadId)}`
        : `/leads/${encodeURIComponent(this.data.leadId)}`;
      const result = await api.request(path, 'GET');
      const payload = result.data || {};
      const schemes = decorateSchemes(payload.publishedSchemes, this.data.leadId, audience);
      const totalImages = schemes.reduce((sum, scheme) => sum + scheme.imageCount, 0);
      const preferredId = String(this.data.schemeId || '');
      const selected = schemes.find((scheme) => scheme.id === preferredId)
        || schemes[schemes.length - 1]
        || null;
      this.setData({
        heroTitle: buildHeroTitle(payload, audience),
        heroSubtitle: schemes.length
          ? `已发布 ${schemes.length} 轮方案 · 共 ${totalImages} 张效果图`
          : '设计师尚未发布方案',
        schemes,
        showSchemeChips: schemes.length > 1,
        selectedSchemeId: selected ? selected.id : '',
        selectedScheme: selected,
        timelineImages: selected
          ? selected.images.slice().reverse()
          : [],
        loading: false,
      });
      this.loadProtectedImages(schemes);
    } catch (error) {
      this.setData({
        loading: false,
        error: (error && (error.message || error.error)) || '暂时无法加载方案册',
      });
    }
  },

  async loadProtectedImages(schemes) {
    const requestId = this._assetRequestId;
    const schemeResults = await Promise.all((schemes || []).map(async (scheme) => ({
      ...scheme,
      images: await Promise.all((scheme.images || []).map(async (design) => {
        if (!design.imageEndpoint) return { ...design, imageState: 'error' };
        try {
          const imagePath = await fetchProtectedImage(
            design.imageEndpoint,
            `${this.data.leadId}-${design.generationId || design.id}`
          );
          return { ...design, imagePath, imageState: 'loaded' };
        } catch (error) {
          console.warn('Failed to load published scheme image', error);
          return { ...design, imageState: 'error' };
        }
      })),
    })));
    if (requestId !== this._assetRequestId) return;
    const decorated = schemeResults.map((scheme) => {
      const cover = scheme.images.length ? scheme.images[scheme.images.length - 1] : null;
      return {
        ...scheme,
        cover,
        deliveryLabel: formatDeliveryTime((cover && cover.publishedAt) || scheme.publishedAt),
      };
    });
    const selected = decorated.find((scheme) => scheme.id === this.data.selectedSchemeId)
      || decorated[decorated.length - 1]
      || null;
    this.setData({
      schemes: decorated,
      selectedScheme: selected,
      timelineImages: selected ? selected.images.slice().reverse() : [],
    });
  },

  selectScheme(event) {
    const schemeId = String(event.currentTarget.dataset.schemeId || '');
    const selected = this.data.schemes.find((scheme) => scheme.id === schemeId);
    if (!selected) return;
    this.setData({
      selectedSchemeId: selected.id,
      selectedScheme: selected,
      timelineImages: selected.images.slice().reverse(),
    });
  },

  previewCurrentScheme(event) {
    const scheme = this.data.selectedScheme;
    if (!scheme) return;
    const urls = (scheme.images || []).map((item) => item.imagePath).filter(Boolean);
    if (!urls.length) {
      wx.showToast({ title: '方案图片加载中，请稍后重试', icon: 'none' });
      return;
    }
    const currentId = event && event.currentTarget && event.currentTarget.dataset
      ? String(event.currentTarget.dataset.generationId || '')
      : '';
    const currentImage = (scheme.images || []).find((item) => String(item.generationId || item.id) === currentId);
    wx.previewImage({
      current: (currentImage && currentImage.imagePath) || urls[urls.length - 1],
      urls,
    });
  },

  async saveOrShareScheme() {
    const scheme = this.data.selectedScheme;
    const cover = scheme && scheme.cover;
    if (!cover || !cover.imagePath) {
      wx.showToast({ title: '方案图片加载中，请稍后重试', icon: 'none' });
      return;
    }
    try {
      await wx.saveImageToPhotosAlbum({ filePath: cover.imagePath });
      wx.showToast({ title: '方案已保存到相册', icon: 'success' });
    } catch (error) {
      const message = error && error.errMsg || '';
      if (message.includes('auth deny') || message.includes('auth denied')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册，或使用底部分享按钮转发方案。',
          confirmText: '去设置',
          success: (result) => result.confirm && wx.openSetting(),
        });
        return;
      }
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const { leadId, selectedScheme, heroTitle } = this.data;
    const imageUrl = selectedScheme && selectedScheme.cover && selectedScheme.cover.imagePath;
    return {
      title: heroTitle ? `${heroTitle} · 设计方案` : '设计方案',
      path: `/packages/business/customer-ai-schemes/customer-ai-schemes?leadId=${encodeURIComponent(leadId)}&schemeId=${encodeURIComponent((selectedScheme && selectedScheme.id) || '')}&mode=customer`,
      imageUrl: imageUrl || undefined,
    };
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    const { leadId, audience } = this.data;
    if (!leadId) return;
    const url = audience === 'staff'
      ? `/packages/business/lead-detail/lead-detail?id=${encodeURIComponent(leadId)}`
      : `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}`;
    wx.redirectTo({ url });
  },
});
