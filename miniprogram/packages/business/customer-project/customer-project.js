const api = require('../../../utils/api');

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

function formatRange(range) {
  const match = String(range || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return { date: '待确认', time: '' };
  const start = new Date(match[1].replaceAll('"', ''));
  const end = new Date(match[2].replaceAll('"', ''));
  const two = (value) => String(value).padStart(2, '0');
  return { date: `${start.getFullYear()}-${two(start.getMonth() + 1)}-${two(start.getDate())}`, time: `${two(start.getHours())}:${two(start.getMinutes())} - ${two(end.getHours())}:${two(end.getMinutes())}` };
}

function formatPlanDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '正式量房已完成';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日完成`;
}

function buildProjectStages(project) {
  const hasAppointment = Boolean(project && project.appointment && project.appointment.status === 'confirmed');
  const hasFormalFloorPlan = Boolean(project && project.formalFloorPlan);
  const hasPublishedDesign = Array.isArray(project && project.publishedDesigns) && project.publishedDesigns.length > 0;
  const stages = [
    { label: '预约确认', complete: hasAppointment },
    { label: '正式量房', complete: hasFormalFloorPlan },
    { label: '方案已发布', complete: hasPublishedDesign },
  ];
  const currentIndex = stages.findIndex((item) => !item.complete);
  return stages.map((item, index) => ({
    ...item,
    state: item.complete ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

function getAuthToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function fetchPublishedImage(endpoint, cacheKey) {
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
          reject(new Error('已发布方案图片格式不受支持'));
          return;
        }
        const safeKey = String(cacheKey || 'published').replace(/[^a-zA-Z0-9_-]/g, '');
        const filePath = `${wx.env.USER_DATA_PATH}/customer-project-design-${safeKey || 'published'}.${extension}`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success: () => resolve(filePath),
          fail: (error) => reject(error instanceof Error ? error : new Error(error && error.errMsg || '图片临时文件写入失败')),
        });
      },
      fail: (error) => reject(error instanceof Error ? error : new Error(error && error.errMsg || '已发布方案图片读取失败')),
    });
  });
}

function decoratePublishedDesigns(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    imagePath: '',
    imageState: item && item.imageEndpoint ? 'loading' : 'error',
  }));
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    leadId: '',
    loading: true,
    appointment: null,
    measurerName: '',
    designer: null,
    range: null,
    formalFloorPlan: null,
    publishedDesigns: [],
    stages: buildProjectStages(null),
    error: '',
  },

  onLoad(query) {
    this._publishedImageRequestId = 0;
    this.setData({ ...navigationMetrics(), leadId: query.leadId || query.id || '' });
    this.load();
  },

  async onShow() {
    if (this.data.leadId) await this.load();
  },

  onUnload() {
    this._publishedImageRequestId = (this._publishedImageRequestId || 0) + 1;
  },

  async load() {
    if (!this.data.leadId) return this.setData({ loading: false, error: '缺少客户项目' });
    this._publishedImageRequestId = (this._publishedImageRequestId || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(`/miniprogram/customer-projects/${encodeURIComponent(this.data.leadId)}`, 'GET');
      const project = result.data || {};
      const appointment = project.appointment || null;
      const publishedDesigns = decoratePublishedDesigns(project.publishedDesigns);
      const formalFloorPlan = project.formalFloorPlan
        ? {
            ...project.formalFloorPlan,
            displayCompletedAt: formatPlanDate(project.formalFloorPlan.completedAt || project.formalFloorPlan.updatedAt),
          }
        : null;
      this.setData({
        appointment,
        measurerName: project.measurerName || (appointment && appointment.measurerName) || '',
        designer: project.designer || null,
        range: appointment ? formatRange(appointment.timeRange) : null,
        formalFloorPlan,
        publishedDesigns,
        stages: buildProjectStages(project),
      });
      this.loadPublishedImages(publishedDesigns);
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法加载服务档案' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadPublishedImages(designs) {
    const requestId = this._publishedImageRequestId;
    const hydrated = await Promise.all((designs || []).map(async (design) => {
      if (!design.imageEndpoint) return { ...design, imageState: 'error' };
      try {
        const imagePath = await fetchPublishedImage(design.imageEndpoint, `${this.data.leadId}-${design.generationId || design.id}`);
        return { ...design, imagePath, imageState: 'loaded' };
      } catch (error) {
        console.warn('Failed to load customer published design image', error);
        return { ...design, imageState: 'error' };
      }
    }));
    if (requestId !== this._publishedImageRequestId) return;
    this.setData({ publishedDesigns: hydrated });
  },

  reschedule() {
    const { appointment, leadId } = this.data;
    if (!appointment) return;
    wx.navigateTo({ url: `/packages/business/appointment-reschedule/appointment-reschedule?leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointment.id)}&version=${appointment.version}` });
  },

  bookAppointment() {
    if (this.data.appointment || !this.data.leadId) return;
    wx.navigateTo({ url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(this.data.leadId)}&mode=customer` });
  },

  onShareAppMessage() {
    const { leadId, appointment } = this.data;
    if (!leadId || !appointment) return { title: '我的上门量房预约' };
    return {
      title: '我的上门量房预约',
      path: `/packages/business/appointment-detail/appointment-detail?mode=customer&leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointment.id)}`,
    };
  },

  previewPublishedDesign(event) {
    const index = Number(event.currentTarget.dataset.index);
    const design = this.data.publishedDesigns[index];
    if (!design || !design.imagePath) return;
    const urls = this.data.publishedDesigns.map((item) => item.imagePath).filter(Boolean);
    wx.previewImage({ current: design.imagePath, urls });
  },

  onBack() { wx.navigateBack(); },
});
