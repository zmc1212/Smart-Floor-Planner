const api = require('../../utils/api.js');
const {
  buildCompanionState,
  buildProgressPills,
} = require('../../utils/customerServiceHome.js');
const {
  hasDesignerContact,
  designerShortcutDescription,
  copyDesignerWechatId,
} = require('../../utils/designerContact.js');
const {
  fetchProtectedImage,
  readCachedProtectedImage,
  floorPlanCacheKey,
  publishedImageCacheKey,
} = require('../../utils/protectedImageCache.js');

const FREE_DESIGN_ROUTE = 'packages/business/free-design-service/free-design-service';
const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';
const XIAO_K_IMAGE = '/images/airy-v1/project-delivery-xiao-k.png';

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function resolveServiceEntryUrl(scanResult) {
  const candidates = [
    String((scanResult && scanResult.path) || '').trim(),
    String((scanResult && scanResult.result) || '').trim(),
  ].filter(Boolean);

  for (const raw of candidates) {
    let pathPart = raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        pathPart = `${parsed.pathname.replace(/^\//, '')}${parsed.search || ''}`;
      }
    } catch (error) {
      pathPart = raw;
    }

    const normalized = pathPart.replace(/^\/+/, '');
    const queryIndex = normalized.indexOf('?');
    const route = (queryIndex === -1 ? normalized : normalized.slice(0, queryIndex)).replace(/\.html$/, '');
    const query = queryIndex === -1 ? '' : normalized.slice(queryIndex + 1);
    if (!/(^|&)(token|scene)=[^&]+/.test(query)) continue;
    if (route === FREE_DESIGN_ROUTE || route === ONBOARDING_ROUTE) {
      return `/${route}${queryIndex === -1 ? '' : normalized.slice(queryIndex)}`;
    }
  }
  return '';
}

function formatUpdatedAt(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '服务状态将持续更新';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日更新`;
}

function switcherTitle(project) {
  if (project && (project.serviceStage === 'design_published' || project.serviceStage === 'converted')) {
    return '我的装修服务';
  }
  return '免费设计服务';
}

function emptyCompanionUi() {
  return {
    subtitle: '领取服务后，当前阶段和下一步会出现在这里',
    insetTitle: '扫码领取免费设计服务',
    insetHelper: '小K陪你从量房到方案全程推进',
    leadId: null,
    nextActionKind: null,
    primaryCta: { label: '扫码领取服务', kind: 'scan_claim' },
    secondaryCta: null,
    showSecondaryCta: false,
    showSwitcher: false,
    switcherCount: 0,
    switcherProjects: [],
    mediaMode: 'xiao_k',
    xiaoKAction: '等待领取',
    isEmpty: true,
    progressPills: buildProgressPills(''),
    bookShortcutKind: '',
    bookShortcutDesc: '免费上门精准量尺',
  };
}

Component({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    selectedLeadId: '',
    projects: [],
    subtitle: '',
    insetTitle: '',
    insetHelper: '',
    leadId: null,
    nextActionKind: null,
    primaryCta: null,
    secondaryCta: null,
    showSecondaryCta: false,
    showSwitcher: false,
    switcherCount: 0,
    switcherProjects: [],
    mediaMode: 'xiao_k',
    xiaoKAction: '',
    isEmpty: true,
    progressPills: [],
    bookShortcutKind: '',
    bookShortcutDesc: '免费上门精准量尺',
    designer: null,
    designerSoftCopy: '设计师匹配后可联系',
    designerShortcutDesc: '设计师匹配后可联系',
    appointmentId: '',
    appointmentVersion: '',
    floorPlanImagePath: '',
    schemeImagePath: '',
    showFloorPlanThumb: false,
    showSchemeThumb: false,
    showXiaoK: true,
    xiaoKImage: XIAO_K_IMAGE,
    showSwitcherSheet: false,
    showContactSheet: false,
  },

  lifetimes: {
    attached() {
      this._assetRequestId = 0;
      this._hasLoaded = false;
      this.setData(navigationMetrics());
    },
  },

  pageLifetimes: {
    show() {
      if (this._pageVisible) return;
      this._pageVisible = true;
      this.load();
    },
    hide() {
      this._pageVisible = false;
    },
  },

  methods: {
    async load(options = {}) {
      this._assetRequestId = (this._assetRequestId || 0) + 1;
      const requestId = this._assetRequestId;
      const forceLoading = !!(options && options.forceLoading);
      const softRefresh = this._hasLoaded && !this.data.error && !forceLoading;
      if (softRefresh) {
        this.setData({ error: '' });
      } else {
        this.setData({ loading: true, error: '' });
      }
      try {
        const listResult = await api.request('/miniprogram/customer-projects', 'GET');
        if (requestId !== this._assetRequestId) return;

        const projects = Array.isArray(listResult.data) ? listResult.data : [];
        const companion = buildCompanionState({
          projects,
          selectedLeadId: this.data.selectedLeadId || undefined,
        });

        if (companion.isEmpty || !companion.leadId) {
          this._hasLoaded = true;
          this.setData({
            ...emptyCompanionUi(),
            projects,
            loading: false,
            designer: null,
            designerShortcutDesc: '设计师匹配后可联系',
            appointmentId: '',
            appointmentVersion: '',
            floorPlanImagePath: '',
            schemeImagePath: '',
            showFloorPlanThumb: false,
            showSchemeThumb: false,
            showXiaoK: true,
            showSwitcherSheet: false,
            showContactSheet: false,
          });
          return;
        }

        const featuredLeadId = companion.leadId;
        const featuredListItem = projects.find((item) => item.leadId === featuredLeadId) || null;
        let detail = null;
        let detailFailed = false;

        try {
          const detailResult = await api.request(
            `/miniprogram/customer-projects/${encodeURIComponent(featuredLeadId)}`,
            'GET'
          );
          if (requestId !== this._assetRequestId) return;
          detail = detailResult.data || null;
        } catch (detailError) {
          detailFailed = true;
          console.warn('Failed to load featured customer project detail', detailError);
        }

        const appointmentId = String(
          (detail && detail.appointment && detail.appointment.id)
            || (featuredListItem && featuredListItem.appointmentId)
            || ''
        );
        const appointmentVersion = String(
          (detail && detail.appointment && detail.appointment.version != null
            ? detail.appointment.version
            : '')
            || (featuredListItem && featuredListItem.appointmentVersion != null
              ? featuredListItem.appointmentVersion
              : '')
            || ''
        );
        const designer = detailFailed ? null : ((detail && detail.designer) || null);
        const designerShortcutDesc = designerShortcutDescription(designer);
        const mediaMode = detailFailed ? 'xiao_k' : companion.mediaMode;
        const progressPills = buildProgressPills(
          (detail && detail.serviceStage) || (featuredListItem && featuredListItem.serviceStage) || ''
        );
        const switcherProjects = (companion.switcherProjects || []).map((project) => ({
          ...project,
          switcherTitle: switcherTitle(project),
          updatedLabel: formatUpdatedAt(project.updatedAt),
        }));

        const needsFloorPlan = !detailFailed && (mediaMode === 'floor_plan' || mediaMode === 'dual');
        const needsScheme = !detailFailed && (mediaMode === 'scheme' || mediaMode === 'dual');
        const cachedFloorPlanPath = needsFloorPlan && detail && detail.formalFloorPlan
          ? readCachedProtectedImage(floorPlanCacheKey(featuredLeadId, detail.formalFloorPlan))
          : '';
        const featuredSchemeUrl = needsScheme && detail && detail.featuredScheme
          && detail.featuredScheme.imageUrl
          && /^https?:\/\//i.test(String(detail.featuredScheme.imageUrl))
          ? detail.featuredScheme.imageUrl
          : '';
        const cachedSchemePath = featuredSchemeUrl || (needsScheme && detail && detail.featuredScheme
          ? readCachedProtectedImage(publishedImageCacheKey(
            featuredLeadId,
            detail.featuredScheme.generationId
          ))
          : '');

        this._hasLoaded = true;
        this.setData({
          ...companion,
          projects,
          progressPills,
          switcherProjects,
          mediaMode,
          designer,
          designerSoftCopy: '设计师匹配后可联系',
          designerShortcutDesc,
          appointmentId,
          appointmentVersion,
          floorPlanImagePath: cachedFloorPlanPath,
          schemeImagePath: cachedSchemePath,
          showFloorPlanThumb: Boolean(cachedFloorPlanPath),
          showSchemeThumb: Boolean(cachedSchemePath),
          showXiaoK: !(cachedFloorPlanPath || cachedSchemePath),
          loading: false,
          showSwitcherSheet: false,
          showContactSheet: false,
        });

        if (!detailFailed && detail) {
          this.loadProtectedMedia(detail, mediaMode, featuredLeadId, requestId);
        }
      } catch (error) {
        if (requestId !== this._assetRequestId) return;
        this.setData({
          loading: false,
          error: error.message || error.error || '暂时无法加载服务向导',
        });
      }
    },

    async loadProtectedMedia(detail, mediaMode, leadId, requestId) {
      const needsFloorPlan = mediaMode === 'floor_plan' || mediaMode === 'dual';
      const needsScheme = mediaMode === 'scheme' || mediaMode === 'dual';
      const floorPlanEndpoint = detail.formalFloorPlan && detail.formalFloorPlan.previewEndpoint;
      const schemeDirectUrl = detail.featuredScheme
        && detail.featuredScheme.imageUrl
        && /^https?:\/\//i.test(String(detail.featuredScheme.imageUrl))
        ? detail.featuredScheme.imageUrl
        : '';
      const schemeEndpoint = !schemeDirectUrl && detail.featuredScheme
        ? detail.featuredScheme.imageEndpoint
        : '';

      const tasks = [];
      if (needsFloorPlan && floorPlanEndpoint) {
        tasks.push(
          fetchProtectedImage(floorPlanEndpoint, floorPlanCacheKey(leadId, detail.formalFloorPlan))
            .then((imagePath) => ({ type: 'floorPlan', imagePath }))
            .catch((error) => {
              console.warn('Failed to load home floor plan preview', error);
              return { type: 'floorPlan', imagePath: '' };
            })
        );
      }
      if (needsScheme && schemeDirectUrl) {
        tasks.push(Promise.resolve({ type: 'scheme', imagePath: schemeDirectUrl }));
      } else if (needsScheme && schemeEndpoint) {
        tasks.push(
          fetchProtectedImage(
            schemeEndpoint,
            publishedImageCacheKey(leadId, detail.featuredScheme && detail.featuredScheme.generationId)
          )
            .then((imagePath) => ({ type: 'scheme', imagePath }))
            .catch((error) => {
              console.warn('Failed to load home scheme preview', error);
              return { type: 'scheme', imagePath: '' };
            })
        );
      }

      if (!tasks.length) {
        if (requestId !== this._assetRequestId) return;
        this.setData({
          showFloorPlanThumb: false,
          showSchemeThumb: false,
          showXiaoK: true,
        });
        return;
      }

      const results = await Promise.all(tasks);
      if (requestId !== this._assetRequestId) return;

      let floorPlanImagePath = '';
      let schemeImagePath = '';
      for (const item of results) {
        if (item.type === 'floorPlan') floorPlanImagePath = item.imagePath || '';
        if (item.type === 'scheme') schemeImagePath = item.imagePath || '';
      }

      const showFloorPlanThumb = Boolean(floorPlanImagePath);
      const showSchemeThumb = Boolean(schemeImagePath);
      const showXiaoK = !(showFloorPlanThumb && showSchemeThumb)
        && !(mediaMode === 'floor_plan' && showFloorPlanThumb)
        && !(mediaMode === 'scheme' && showSchemeThumb);

      this.setData({
        floorPlanImagePath,
        schemeImagePath,
        showFloorPlanThumb,
        showSchemeThumb,
        showXiaoK: showXiaoK || (!showFloorPlanThumb && !showSchemeThumb),
      });
    },

    openScan() {
      this.scanServiceOrInviteCode();
    },

    scanServiceOrInviteCode() {
      wx.scanCode({
        onlyFromCamera: false,
        success: (scanResult) => {
          const url = resolveServiceEntryUrl(scanResult);
          if (!url) {
            wx.showToast({ title: '请扫描服务码或邀请码', icon: 'none' });
            return;
          }
          wx.navigateTo({ url });
        },
        fail: () => {
          wx.showToast({ title: '扫码已取消', icon: 'none' });
        },
      });
    },

    openArchive(leadId) {
      const id = leadId || this.data.leadId;
      if (!id) return;
      wx.navigateTo({
        url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(id)}`,
      });
    },

    openBooking(leadId) {
      const id = leadId || this.data.leadId;
      if (!id) return;
      wx.navigateTo({
        url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(id)}&mode=customer`,
      });
    },

    openReschedule() {
      const { leadId, appointmentId } = this.data;
      if (!leadId || !appointmentId) {
        wx.showToast({ title: '暂时无法改期，请稍后再试', icon: 'none' });
        return;
      }
      wx.navigateTo({
        url: `/packages/business/appointment-detail/appointment-detail?mode=customer&leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointmentId)}`,
      });
    },

    onPrimaryCta() {
      const kind = this.data.nextActionKind || (this.data.primaryCta && this.data.primaryCta.kind);
      if (kind === 'scan_claim' || this.data.isEmpty) {
        this.scanServiceOrInviteCode();
        return;
      }
      if (kind === 'book' || kind === 'rebook') {
        this.openBooking();
        return;
      }
      if (kind === 'reschedule') {
        this.openReschedule();
        return;
      }
      if (kind === 'wait_designer') {
        wx.showToast({ title: '派单完成后可预约', icon: 'none' });
        return;
      }
      this.openArchive();
    },

    onSecondaryCta() {
      this.openArchive();
    },

    openBookShortcut() {
      const kind = this.data.bookShortcutKind || this.data.nextActionKind;
      if (kind === 'book' || kind === 'rebook') {
        this.openBooking();
        return;
      }
      if (kind === 'reschedule') {
        this.openReschedule();
        return;
      }
      if (this.data.leadId) {
        this.openArchive();
      }
    },

    openDesignerShortcut() {
      const designer = this.data.designer;
      if (hasDesignerContact(designer)) {
        if (designer.wechatQrUrl) {
          this.setData({ showContactSheet: true });
          return;
        }
        copyDesignerWechatId(designer.wechatId, { withSearchHint: true }).catch(() => {
          wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' });
        });
        return;
      }
      if (this.data.leadId) {
        wx.showToast({ title: this.data.designerSoftCopy || '设计师匹配后可联系', icon: 'none' });
        this.openArchive();
      }
    },

    closeContactSheet() {
      this.setData({ showContactSheet: false });
    },

    openSwitcher() {
      if (!this.data.showSwitcher) return;
      this.setData({ showSwitcherSheet: true });
    },

    closeSwitcher() {
      this.setData({ showSwitcherSheet: false });
    },

    selectSwitcherProject(event) {
      const leadId = String((event.currentTarget.dataset && event.currentTarget.dataset.leadId) || '');
      if (!leadId) return;
      this.setData({ selectedLeadId: leadId, showSwitcherSheet: false, showContactSheet: false }, () => this.load());
    },

    retry() {
      this.load({ forceLoading: true });
    },

    noop() {},
  },
});
