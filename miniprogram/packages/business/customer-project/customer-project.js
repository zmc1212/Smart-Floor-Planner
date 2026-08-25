const api = require('../../../utils/api');
const {
  hasDesignerContact,
  copyDesignerWechatId,
} = require('../../../utils/designerContact');
const {
  fetchProtectedImage,
  readCachedProtectedImage,
  floorPlanCacheKey,
  publishedImageCacheKey,
} = require('../../../utils/protectedImageCache');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange.js');
const sitePhotos = require('../../../utils/sitePhotoService.js');

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
  const display = formatAppointmentDisplay(range);
  if (!display.dateKey) return { date: '待确认', time: '' };
  return { date: display.dateKey, time: display.timeText };
}

function buildProjectStages(project) {
  const hasAppointment = Boolean(project && project.appointment && ['confirmed', 'completed'].includes(project.appointment.status));
  const surveyDone = ['survey_completed', 'design_published', 'converted'].includes(String(project && project.serviceStage || ''));
  const hasPublishedDesign = (Array.isArray(project && project.publishedSchemes) && project.publishedSchemes.length > 0)
    || (Array.isArray(project && project.publishedDesigns) && project.publishedDesigns.length > 0);
  const stages = [
    { label: '预约确认', complete: hasAppointment },
    { label: '量房', complete: surveyDone },
    { label: '设计出图', complete: hasPublishedDesign },
    { label: '方案交付', complete: hasPublishedDesign },
  ];
  const currentIndex = stages.findIndex((item) => !item.complete);
  return stages.map((item, index) => ({
    ...item,
    state: item.complete ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

function previousImageMap(schemes) {
  const map = {};
  (Array.isArray(schemes) ? schemes : []).forEach((scheme) => {
    (scheme && scheme.images ? scheme.images : []).forEach((image) => {
      const key = String((image && (image.generationId || image.id)) || '');
      if (key && image.imagePath) map[key] = { imagePath: image.imagePath, imageState: image.imageState };
    });
  });
  return map;
}

function decoratePublishedDesigns(items, leadId, previousById) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = String((item && (item.generationId || item.id)) || '');
    if (item && item.imageUrl && /^https?:\/\//i.test(String(item.imageUrl))) {
      return {
        ...item,
        imagePath: item.imageUrl,
        imageState: 'loaded',
      };
    }
    const diskPath = key ? readCachedProtectedImage(publishedImageCacheKey(leadId, key)) : '';
    const previous = previousById && previousById[key];
    const imagePath = diskPath || (previous && previous.imagePath) || '';
    return {
      ...item,
      imagePath,
      imageState: imagePath ? 'loaded' : (item && item.imageEndpoint ? 'loading' : 'error'),
    };
  });
}

function decoratePublishedSchemes(schemes, designs, leadId, previousById) {
  if (Array.isArray(schemes) && schemes.length) {
    return schemes.map((scheme) => ({
      ...scheme,
      images: decoratePublishedDesigns(scheme && scheme.images, leadId, previousById),
    }));
  }
  const images = decoratePublishedDesigns(designs, leadId, previousById);
  if (!images.length) return [];
  return [{ id: 'legacy', title: '其他效果图', images }];
}

function buildFeaturedDelivery(schemes, fallbackScheme) {
  const featuredFromSchemes = (Array.isArray(schemes) ? schemes : []).find((scheme) => scheme && scheme.finalized)
    || (schemes && schemes[0]);
  if (featuredFromSchemes && featuredFromSchemes.images && featuredFromSchemes.images[0]) {
    const first = featuredFromSchemes.images[0];
    return {
      id: featuredFromSchemes.id,
      title: featuredFromSchemes.title,
      publishedLabel: buildPublishedSchemeLabel(featuredFromSchemes),
      styleTag: String(featuredFromSchemes.title || '').startsWith('#')
        ? featuredFromSchemes.title
        : `#${featuredFromSchemes.title || '设计方案'}`,
      images: featuredFromSchemes.images,
      imagePath: first.imagePath || '',
      imageState: first.imageState,
      generationId: first.generationId || first.id,
    };
  }
  if (!fallbackScheme) return null;
  const directUrl = fallbackScheme.imageUrl && /^https?:\/\//i.test(String(fallbackScheme.imageUrl))
    ? fallbackScheme.imageUrl
    : '';
  return {
    ...fallbackScheme,
    publishedLabel: buildPublishedSchemeLabel(fallbackScheme),
    imagePath: directUrl,
    imageState: directUrl ? 'loaded' : (fallbackScheme.imageEndpoint ? 'loading' : 'error'),
    images: [],
  };
}

function buildPublishedSchemeLabel(scheme) {
  if (scheme && scheme.finalized) {
    const title = String(scheme.title || '').trim().replace(/^#+/, '');
    return title ? `已定稿 · ${title}` : '已定稿';
  }
  const title = String(scheme && (scheme.title || scheme.schemeTitle) || '').trim().replace(/^#+/, '');
  if (!title) return '已发布方案';
  return `已发布${title.endsWith('方案') ? title : `${title}方案`}`;
}

function buildDesignerLine(designer) {
  if (!designer || !designer.displayName) return '待分配设计师';
  return designer.wechatId ? `${designer.displayName} · 在线沟通` : `${designer.displayName} · 专属服务`;
}

function staffPhone(value) {
  return String(value || '').trim();
}

function buildMeasurerLine(measurerName, formalFloorPlan) {
  if (!measurerName) return '待分配量房员';
  if (formalFloorPlan && formalFloorPlan.surveyStatusLabel) {
    return `${measurerName} · ${formalFloorPlan.surveyStatusLabel}`;
  }
  return `${measurerName} · 待预约`;
}

function shouldShowBookingPanel(project) {
  if (!project) return false;
  if (project.canRebook || project.canReschedule) return true;
  return Boolean(project.appointment && !project.formalFloorPlan);
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
    designerName: '待分配',
    designerAssigned: false,
    designerLine: '待分配设计师',
    designerPhone: '',
    measurerLine: '待分配量房员',
    measurerPhone: '',
    range: null,
    formalFloorPlan: null,
    floorPlanImagePath: '',
    floorPlanImageState: '',
    featuredDelivery: null,
    publishedSchemes: [],
    publishedDesigns: [],
    stages: buildProjectStages(null),
    heroTitle: '',
    heroSubtitle: '',
    navSubtitle: '',
    serviceStageLabel: '',
    nextAction: '',
    canRebook: false,
    canReschedule: false,
    showBookingPanel: false,
    appointmentBadge: '',
    bookingHint: '',
    error: '',
    canContactDesigner: false,
    showContactSheet: false,
    showSchemePoster: false,
    posterImagePath: '',
    posterSchemeTitle: '',
    sitePhotos: [],
    sitePhotoTags: sitePhotos.SPACE_TAGS,
    sitePhotoUploading: false,
    sitePhotoLimitReached: false,
    sitePhotoManagerOpen: false,
  },

  onLoad(query) {
    this._assetRequestId = 0;
    this._archiveReady = false;
    this.setData({ ...navigationMetrics(), leadId: query.leadId || query.id || '' });
    this.load();
  },

  async onShow() {
    if (typeof wx.hideShareMenu === 'function') {
      wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
    if (!this.data.leadId || !this._archiveReady) return;
    await this.load({ silent: true });
  },

  onUnload() {
    this._assetRequestId = (this._assetRequestId || 0) + 1;
    this._archiveReady = false;
  },

  async load(options) {
    const silent = Boolean(options && options.silent);
    if (!this.data.leadId) return this.setData({ loading: false, error: '缺少客户项目' });
    this._assetRequestId = (this._assetRequestId || 0) + 1;
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(`/miniprogram/customer-projects/${encodeURIComponent(this.data.leadId)}`, 'GET');
      const project = result.data || {};
      const appointment = project.appointment || null;
      const publishedSchemes = decoratePublishedSchemes(
        project.publishedSchemes,
        project.publishedDesigns,
        this.data.leadId,
        previousImageMap(this.data.publishedSchemes)
      );
      const publishedDesigns = publishedSchemes.flatMap((scheme) => scheme.images);
      const formalFloorPlan = project.formalFloorPlan || null;
      const sameFloorPlan = Boolean(
        silent
        && this.data.formalFloorPlan
        && formalFloorPlan
        && String(this.data.formalFloorPlan.id) === String(formalFloorPlan.id)
        && String(this.data.formalFloorPlan.updatedAt || '') === String(formalFloorPlan.updatedAt || '')
      );
      const cachedFloorPlanPath = formalFloorPlan
        ? readCachedProtectedImage(floorPlanCacheKey(this.data.leadId, formalFloorPlan))
        : '';
      const floorPlanImagePath = cachedFloorPlanPath
        || (sameFloorPlan ? this.data.floorPlanImagePath : '')
        || '';
      const featuredDelivery = buildFeaturedDelivery(publishedSchemes, project.featuredScheme);
      const canRebook = Boolean(project.canRebook);
      const canReschedule = Boolean(project.canReschedule);
      const measurerName = project.measurerName || (appointment && appointment.measurerName) || '';
      this.setData({
        appointment,
        measurerName,
        designer: project.designer || null,
        designerName: project.designer && project.designer.displayName || '待分配',
        designerAssigned: Boolean(project.designer && project.designer.displayName),
        canContactDesigner: hasDesignerContact(project.designer),
        showContactSheet: false,
        designerLine: buildDesignerLine(project.designer),
        designerPhone: staffPhone(project.designer && project.designer.phone),
        measurerLine: buildMeasurerLine(
          measurerName,
          formalFloorPlan
        ),
        measurerPhone: staffPhone(project.measurerPhone || (appointment && appointment.measurerPhone)),
        range: appointment ? formatRange(appointment.timeRange) : null,
        formalFloorPlan,
        floorPlanImagePath,
        floorPlanImageState: floorPlanImagePath
          ? 'loaded'
          : (formalFloorPlan && formalFloorPlan.previewEndpoint ? 'loading' : ''),
        featuredDelivery,
        publishedSchemes,
        publishedDesigns,
        stages: buildProjectStages(project),
        heroTitle: project.heroTitle || '',
        heroSubtitle: project.heroSubtitle || '免费量房与设计方案全纪录',
        navSubtitle: project.navSubtitle || '',
        serviceStageLabel: project.serviceStageLabel || '',
        nextAction: project.nextAction || '',
        canRebook,
        canReschedule,
        showBookingPanel: shouldShowBookingPanel({ ...project, formalFloorPlan, appointment, canRebook, canReschedule }),
        appointmentBadge: measurerName ? '已匹配测量员' : (project.serviceStageLabel || '服务准备中'),
        bookingHint: canRebook && !appointment
          ? '选择方便的时间，测量师会提前与你确认'
          : (project.nextAction || ''),
        error: '',
      });
      this._archiveReady = true;
      this.loadProtectedAssets(formalFloorPlan, featuredDelivery, publishedSchemes);
      this.loadSitePhotos();
    } catch (error) {
      this._archiveReady = true;
      if (silent && this.data.heroTitle) return;
      this.setData({ error: error.message || error.error || '暂时无法加载服务档案' });
    } finally {
      if (!silent) this.setData({ loading: false });
    }
  },

  async loadProtectedAssets(formalFloorPlan, featuredDelivery, schemes) {
    const requestId = this._assetRequestId;
    const tasks = [];

    if (formalFloorPlan && formalFloorPlan.previewEndpoint) {
      tasks.push(
        fetchProtectedImage(
          formalFloorPlan.previewEndpoint,
          floorPlanCacheKey(this.data.leadId, formalFloorPlan)
        )
          .then((imagePath) => ({ type: 'floorPlan', imagePath }))
          .catch((error) => {
            console.warn('Failed to load customer floor plan preview', error);
            return { type: 'floorPlan', imageState: 'error' };
          })
      );
    }

    const schemeResults = await Promise.all((schemes || []).map(async (scheme) => ({
      ...scheme,
      images: await Promise.all((scheme.images || []).map(async (design) => {
        if (design.imageState === 'loaded' && design.imagePath) return design;
        if (design.imageUrl && /^https?:\/\//i.test(String(design.imageUrl))) {
          return { ...design, imagePath: design.imageUrl, imageState: 'loaded' };
        }
        if (!design.imageEndpoint) return { ...design, imageState: 'error' };
        try {
          const imagePath = await fetchProtectedImage(
            design.imageEndpoint,
            publishedImageCacheKey(this.data.leadId, design.generationId || design.id)
          );
          return { ...design, imagePath, imageState: 'loaded' };
        } catch (error) {
          console.warn('Failed to load customer published design image', error);
          return { ...design, imageState: 'error' };
        }
      })),
    })));

    if (requestId !== this._assetRequestId) return;

    const assetResults = await Promise.all(tasks);
    const next = {
      publishedSchemes: schemeResults,
      publishedDesigns: schemeResults.flatMap((scheme) => scheme.images),
    };

    for (const item of assetResults) {
      if (item.type === 'floorPlan') {
        next.floorPlanImagePath = item.imagePath || '';
        next.floorPlanImageState = item.imageState || (item.imagePath ? 'loaded' : 'error');
      }
    }

    if (schemeResults[0] && schemeResults[0].images[0]) {
      const first = schemeResults[0].images[0];
      next.featuredDelivery = {
        id: schemeResults[0].id,
        title: schemeResults[0].title,
        publishedLabel: buildPublishedSchemeLabel(schemeResults[0]),
        styleTag: schemeResults[0].title.startsWith('#') ? schemeResults[0].title : `#${schemeResults[0].title}`,
        images: schemeResults[0].images,
        imagePath: first.imagePath || '',
        imageState: first.imageState,
        generationId: first.generationId || first.id,
      };
    }

    this.setData(next);
  },

  reschedule() {
    const { appointment, leadId, canReschedule } = this.data;
    if (!appointment || !canReschedule) return;
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?mode=customer&leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointment.id)}`,
    });
  },

  openAppointment() {
    const { appointment, leadId } = this.data;
    if (!appointment || !leadId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?mode=customer&leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointment.id)}`,
    });
  },

  bookAppointment() {
    if (!this.data.leadId) return;
    if (this.data.appointment && !this.data.canRebook) return;
    wx.navigateTo({ url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(this.data.leadId)}&mode=customer` });
  },

  async loadSitePhotos() {
    if (!this.data.leadId) return;
    try {
      const result = await sitePhotos.list(this.data.leadId);
      this.setData({
        sitePhotos: result.items || [],
        sitePhotoTags: result.spaceTags || sitePhotos.SPACE_TAGS,
        sitePhotoLimitReached: Number(result.remaining || 0) <= 0,
      });
    } catch (error) {
      console.warn('Failed to load site photos', error);
    }
  },

  onSitePhotoUploading(event) {
    this.setData({ sitePhotoUploading: Boolean(event.detail && event.detail.uploading) });
  },

  onSitePhotosChange(event) {
    const photos = sitePhotos.mergePhotos(this.data.sitePhotos, event.detail || {});
    this.setData({
      sitePhotos: photos,
      sitePhotoLimitReached: photos.length >= 30,
    });
  },

  handleDossierRow(event) {
    const kind = String(event.currentTarget.dataset && event.currentTarget.dataset.kind || '');
    if (kind === 'floor') {
      if (this.data.formalFloorPlan) this.previewFloorPlan();
      return;
    }
    if (kind === 'site') {
      this.setData({ sitePhotoManagerOpen: !this.data.sitePhotoManagerOpen });
      return;
    }
    if (kind === 'delivery' && this.data.featuredDelivery) {
      this.previewFeaturedDelivery();
    }
  },

  noop() {},

  contactDesigner() {
    const designer = this.data.designer;
    if (!hasDesignerContact(designer)) {
      wx.showToast({ title: '设计师联系方式暂未提供', icon: 'none' });
      return;
    }
    if (designer.wechatQrUrl) {
      this.setData({ showContactSheet: true });
      return;
    }
    copyDesignerWechatId(designer.wechatId, { withSearchHint: true }).catch(() => {
      wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' });
    });
  },

  closeContactSheet() {
    this.setData({ showContactSheet: false });
  },

  callStaff(event) {
    const phone = String((event.currentTarget.dataset && event.currentTarget.dataset.phone) || '').trim();
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
  },

  previewFloorPlan() {
    const { floorPlanImagePath } = this.data;
    if (!floorPlanImagePath) {
      wx.showToast({ title: '户型图正在加载', icon: 'none' });
      return;
    }
    wx.previewImage({ current: floorPlanImagePath, urls: [floorPlanImagePath] });
  },

  previewFeaturedDelivery() {
    const delivery = this.data.featuredDelivery;
    if (!delivery) return;
    this.openAiSchemes(delivery.id);
  },

  previewPublishedDesign(event) {
    const schemeIndex = Number(event.currentTarget.dataset.schemeIndex);
    const scheme = this.data.publishedSchemes[schemeIndex];
    if (!scheme) return;
    this.openAiSchemes(scheme.id);
  },

  openAiSchemes(schemeId) {
    if (!this.data.leadId) return;
    const query = [
      `leadId=${encodeURIComponent(this.data.leadId)}`,
      'mode=customer',
    ];
    if (schemeId) query.push(`schemeId=${encodeURIComponent(schemeId)}`);
    wx.navigateTo({
      url: `/packages/business/customer-ai-schemes/customer-ai-schemes?${query.join('&')}`,
    });
  },

  openAllAiSchemes() {
    const finalized = this.data.publishedSchemes.find((scheme) => scheme && scheme.finalized);
    this.openAiSchemes(finalized ? finalized.id : '');
  },

  collectPublishedImageUrls() {
    return this.data.publishedSchemes
      .flatMap((scheme) => (scheme.images || []).map((item) => item.imagePath))
      .filter(Boolean);
  },

  saveOrShareScheme() {
    const delivery = this.data.featuredDelivery;
    if (!delivery || !delivery.imagePath) {
      wx.showToast({ title: '方案尚未发布', icon: 'none' });
      return;
    }
    this.setData({
      showSchemePoster: true,
      posterImagePath: delivery.imagePath,
      posterSchemeTitle: String(delivery.title || '').trim() || '设计方案',
    });
  },

  closeSchemePoster() {
    this.setData({
      showSchemePoster: false,
      posterImagePath: '',
      posterSchemeTitle: '',
    });
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/index/index' }),
      });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
