const api = require('../../../utils/api');
const nativePreview = require('../../../utils/native-preview');
const { hasDesignerContact, copyDesignerWechatId } = require('../../../utils/designerContact');
const { renovationProjects, overviewCard } = require('./renovation-overview');

const listPath = '/miniprogram/customer-projects';
const sitePath = '/miniprogram/construction/owner-sites';
const readOptions = { suppressUnauthorized: true };
const assetOptions = { ...readOptions, timeout: 12000 };
const selectionKey = 'customerRenovationSelection';
const archivePath = '/packages/business/customer-project/customer-project?leadId=';
const appointmentPath = '/packages/enterprise/appointment-detail/appointment-detail?mode=customer&leadId=';

const emptyRenovation = { renovationCards: [], renovationIndex: 0, renovation: null, renovationLoading: false,
  renovationError: '', renovationCover: '', renovationCoverError: false, renovationCoverLoading: false,
  renovationAdvisor: null, renovationContactOpen: false, renovationFloorLoading: false };

function ownerKey() {
  const { bootstrap, userInfo } = getApp().globalData;
  return String(bootstrap?.current?.context?.userId || userInfo?._id || userInfo?.id || '');
}

function checkedData(response) {
  if (response?.success === false || !response?.data) throw new Error('Invalid renovation response');
  return response.data;
}

function renovationMethods(session, clearProject) {
  return {
    async listRenovations() {
      const projects = checkedData(await api.request(listPath, 'GET', {}, readOptions));
      if (!Array.isArray(projects)) throw new Error('Invalid service list');
      return projects;
    },
    openRenovations(leads, sites) {
      const cards = renovationProjects(leads, sites);
      const identity = ownerKey();
      const stored = identity && wx.getStorageSync(selectionKey);
      const previous = stored?.ownerKey === identity ? stored.selectedKey : '';
      const matched = cards.findIndex(item => item.key === previous);
      const index = Math.max(matched, 0);
      this.setData({ renovationCards: cards, renovationIndex: index, siteDetail: false });
      if (cards[index]) return this.readRenovation(cards[index]);
    },
    selectRenovation(event) {
      const index = Number(event.detail.value), selected = this.data.renovationCards[index];
      if (!selected || index === this.data.renovationIndex || this.data.familyVisible || this.data.renovationContactOpen) return;
      this.setData({ renovationIndex: index });
      const identity = ownerKey();
      if (identity) wx.setStorageSync(selectionKey, { ownerKey: identity, selectedKey: selected.key });
      return this.readRenovation(selected);
    },
    async readRenovation(selected) {
      const token = session(), generation = this._generation = (this._generation || 0) + 1;
      this._projectSession = token;
      this._selectedRenovation = selected;
      this._renovationService = null;
      this._ownerDecision = null;
      this.clearPrivateLive();
      this.clearRenovationFiles();
      this.setData({ ...clearProject, renovation: null, renovationCover: '', renovationCoverError: false, renovationCoverLoading: false,
        renovationLoading: true, renovationError: '', renovationAdvisor: null, renovationContactOpen: false, renovationFloorLoading: false });
      const leadId = selected.lead?.leadId, siteId = selected.site?.id;
      try {
        const [service, site] = await Promise.all([
          leadId ? api.request(listPath + '/' + leadId, 'GET', {}, readOptions).then(checkedData) : null,
          siteId ? api.request(sitePath + '/' + siteId, 'GET', {}, readOptions).then(checkedData) : null,
        ]);
        if (!this.current(generation, token)) return;
        if (service && service.leadId !== leadId
          || site && (site.project?.id !== siteId || leadId && site.project.leadId !== leadId)) throw new Error('Renovation mismatch');
        const project = site?.project || null;
        this._projectId = project?.id || '';
        this._ownerDecision = project?.progressAccess ? site.decision : null;
        if (project?.progressAccess) await this.readLiveApplication(project.id, generation, token);
        if (!this.current(generation, token)) return;
        this._renovationService = service;
        const card = overviewCard({ service, project, report: site?.report, decision: this._ownerDecision,
          live: this.data.liveApplication, site: selected.site });
        this.setData({ project, report: site?.report || null, renovation: card, renovationLoading: false,
          renovationAdvisor: service?.designer || null, renovationCoverLoading: Boolean(card.scheme?.endpoint) });
        if (card.scheme?.endpoint) void this.loadRenovationCover();
      } catch (error) {
        if (this.current(generation, token)) this.setData({ renovationLoading: false,
          needsLogin: error.statusCode === 401,
          renovationError: [403, 404].includes(error.statusCode) ? '这个装修项目目前不可查看' : '装修资料暂时无法读取' });
      }
    },
    async loadRenovationCover() {
      const token = this._projectSession, generation = this._generation;
      const scheme = this.data.renovation?.scheme;
      if (!this.current(generation, token) || !scheme?.endpoint || this._coverRead === generation) return;
      this._coverRead = generation;
      this.setData({ renovationCoverError: false, renovationCoverLoading: true });
      try {
        const file = await api.downloadFile(scheme.endpoint, assetOptions);
        if (this.current(generation, token)) this.setData({ renovationCover: file.tempFilePath });
        else this.clearReportPhoto(file.tempFilePath);
      } catch {
        if (this.current(generation, token)) this.setData({ renovationCoverError: true });
      } finally {
        if (this._coverRead === generation) this._coverRead = null;
        if (this.current(generation, token)) this.setData({ renovationCoverLoading: false });
      }
    },
    clearRenovationFiles() {
      this.clearReportPhoto(this.data.renovationCover);
      this.clearReportPhoto(this._floorPreviewPath || '');
      this._floorPreviewPath = '';
    },
    renovationCoverFailed() {
      this.clearReportPhoto(this.data.renovationCover);
      this.setData({ renovationCover: '', renovationCoverError: true });
    },
    runRenovationAction(event) {
      const card = this.data.renovation;
      const action = event.currentTarget.dataset.action || card?.action;
      if (!card || !this.current(this._generation, this._projectSession)) return;
      if (action !== card.action && !card.rows.some(row => row.key === action)) return;
      const service = this._renovationService;
      const leadId = service?.leadId;
      switch (action) {
        case 'archive': return this.navigate(archivePath + leadId);
        case 'book': return this.navigate('/packages/enterprise/appointment-booking/appointment-booking?mode=customer&leadId=' + leadId);
        case 'appointment':
        case 'reschedule': return this.navigate(appointmentPath + leadId + '&appointmentId=' + service.appointment.id);
        case 'scheme': return this.navigate('/packages/business/customer-ai-schemes/customer-ai-schemes?mode=customer&leadId='
          + leadId + '&schemeId=' + encodeURIComponent(card.scheme.id) + '&from=renovation');
        case 'contact': return this.contactRenovationAdvisor();
        case 'floorplan': return this.previewRenovationFloorPlan();
        case 'report': return this.openReport(event);
        case 'family': return this.openFamilySheet();
        case 'schedule': return this.showSiteDetail(true);
        case 'site': return this.showSiteDetail();
        case 'live': return this.openLiveApplication();
        case 'decision': return this.openOwnerDecision();
      }
    },
    showSiteDetail(schedule = false) {
      const selected = this._selectedRenovation?.site;
      if (!selected) return;
      this._siteDetailId = selected.id;
      this._openDetailSchedule = schedule;
      this.clearRenovationFiles();
      this.setData({ siteDetail: true, renovationCover: '',
        selectedIndex: Math.max(0, this.data.projects.findIndex(project => project.id === selected.id)) });
      return this.readProject(selected);
    },
    closeSiteDetail() {
      this._siteDetailId = '';
      this._openDetailSchedule = false;
      return this.load();
    },
    contactRenovationAdvisor() {
      const advisor = this.data.renovationAdvisor;
      if (advisor?.wechatQrUrl) this.setData({ renovationContactOpen: true });
      else if (hasDesignerContact(advisor)) {
        return copyDesignerWechatId(advisor.wechatId, { withSearchHint: true }).catch(() =>
          wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' }));
      } else if (advisor?.phone) wx.makePhoneCall({ phoneNumber: advisor.phone });
      else wx.showToast({ title: '设计顾问联系方式暂未提供', icon: 'none' });
    },
    closeRenovationContact() { this.setData({ renovationContactOpen: false }); },
    async previewRenovationFloorPlan() {
      const endpoint = this._renovationService?.formalFloorPlan?.previewEndpoint;
      if (!endpoint || this.data.renovationFloorLoading) return;
      const generation = this._generation, token = this._projectSession;
      this.setData({ renovationFloorLoading: true });
      try {
        const file = await api.downloadFile(endpoint, assetOptions);
        if (!this.current(generation, token)) {
          this.clearReportPhoto(file.tempFilePath);
          return;
        }
        this.clearReportPhoto(this._floorPreviewPath || '');
        this._floorPreviewPath = file.tempFilePath;
        nativePreview.previewImage({ urls: [file.tempFilePath], current: file.tempFilePath });
      } catch {
        if (this.current(generation, token)) wx.showToast({ title: '户型图暂时无法读取，请重试', icon: 'none' });
      } finally {
        if (this.current(generation, token)) this.setData({ renovationFloorLoading: false });
      }
    },
  };
}

module.exports = { emptyRenovation, renovationMethods };
