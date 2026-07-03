const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const templatesUtil = require('../../utils/templates.js');
const wholeHomeGeometry = require('../../utils/wholeHomeGeometry.js');

function parseLayoutObject(layoutData) {
  if (!layoutData) return null;
  if (typeof layoutData === 'string') {
    try {
      return JSON.parse(layoutData);
    } catch (e) {
      return null;
    }
  }
  return layoutData;
}

function isSurveyingPrototypeLayout(layoutData) {
  const parsed = parseLayoutObject(layoutData);
  return !!(
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    parsed.measurementMode === 'surveying_prototype' &&
    parsed.prototypeOnly === true &&
    parsed.surveyDraft &&
    parsed.surveyDraft.kind === 'survey-wall-graph'
  );
}

function getPlanTimestamp(plan, fallbackIndex) {
  const value = Date.parse(plan && (plan.updatedAt || plan.createdAt || ''));
  return isFinite(value) ? value : fallbackIndex;
}

function getLatestSurveyingPrototypePlan(plans) {
  const list = (plans || []).filter((plan) => plan && typeof plan === 'object');
  const matched = list
    .map((plan, index) => ({ plan, index }))
    .filter((item) => isSurveyingPrototypeLayout(item.plan.layoutData))
    .sort((a, b) => getPlanTimestamp(b.plan, b.index) - getPlanTimestamp(a.plan, a.index));
  return matched.length ? matched[0].plan : null;
}

Page({
  data: {
    leadId: null,
    lead: null,
    templates: templatesUtil.templates,
    loading: true,
    kujialeLoading: false,
    kujialeImportingId: '',
    kujialeError: '',
    kujialeResults: [],
    kujialeQuery: {
      city: '',
      communityName: '',
      area: '',
      layout: ''
    },
    activeFloorPlan: null,
    activeSourceLabel: '',
    rooms: [],
    measurementMode: 'room',
    homeOutline: null,
    partitions: [],
    surveyingPrototypePlan: null
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ leadId: options.id });
    }
  },

  onShow() {
    if (this.data.leadId) {
      this.fetchLeadDetail();
    }
  },

  async fetchLeadDetail() {
    this.setData({ loading: true });
    try {
      const res = await api.request(`/leads/${this.data.leadId}`, 'GET');
      if (res.success && res.data) {
        const lead = res.data;
        let activeFloorPlan = null;
        let rooms = [];
        let activeSourceLabel = '';
        let measurementMode = 'room';
        let homeOutline = null;
        let partitions = [];
        const floorPlanList = Array.isArray(lead.floorPlanIds)
          ? lead.floorPlanIds.filter((plan) => plan && typeof plan === 'object')
          : [];
        const primaryFloorPlan = lead.primaryFloorPlanId && typeof lead.primaryFloorPlanId === 'object'
          ? lead.primaryFloorPlanId
          : null;
        const allFloorPlans = primaryFloorPlan ? [primaryFloorPlan, ...floorPlanList] : floorPlanList;
        const surveyingPrototypePlan = getLatestSurveyingPrototypePlan(allFloorPlans);

        if (primaryFloorPlan && !isSurveyingPrototypeLayout(primaryFloorPlan.layoutData)) {
          activeFloorPlan = primaryFloorPlan;
        } else {
          const compatibleFloorPlans = floorPlanList.filter((plan) => !isSurveyingPrototypeLayout(plan.layoutData));
          if (compatibleFloorPlans.length > 0) {
            activeFloorPlan = compatibleFloorPlans[compatibleFloorPlans.length - 1];
          }
        }

        if (activeFloorPlan) {
          activeSourceLabel = this.getFloorPlanSourceLabel(activeFloorPlan);
          const parsed = wholeHomeGeometry.parseLayoutData(activeFloorPlan.layoutData);
          rooms = parsed.rooms || [];
          measurementMode = parsed.measurementMode || 'room';
          if (measurementMode === 'whole_home') activeSourceLabel = '全屋测量';
          homeOutline = parsed.homeOutline || null;
          partitions = parsed.partitions || [];
        }

        this.setData({
          lead,
          activeFloorPlan,
          activeSourceLabel,
          rooms,
          measurementMode,
          homeOutline,
          partitions,
          surveyingPrototypePlan,
          loading: false,
          kujialeQuery: {
            city: lead.city || '',
            communityName: lead.communityName || '',
            area: lead.area || '',
            layout: this.data.kujialeQuery.layout || ''
          }
        });

        if (!activeFloorPlan && lead.communityName) {
          this.searchKujialeFloorPlans();
        }
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  getFloorPlanSourceLabel(plan) {
    if (!plan) return '';
    if (isSurveyingPrototypeLayout(plan.layoutData)) return '新版测绘原型';
    if (plan.source === 'kujiale') return '酷家乐户型';
    if (plan.source === 'template') return '户型模板';
    if (this.data.measurementMode === 'whole_home') return '全屋测量';
    return '手动测绘';
  },

  onKujialeInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`kujialeQuery.${field}`]: e.detail.value
    });
  },

  async searchKujialeFloorPlans() {
    if (this.data.kujialeLoading) return;
    const query = this.data.kujialeQuery || {};
    const communityName = (query.communityName || '').trim();

    if (!communityName) {
      this.setData({ kujialeError: '请先填写小区名称', kujialeResults: [] });
      return;
    }

    this.setData({ kujialeLoading: true, kujialeError: '' });

    try {
      const res = await api.request('/kujiale/floorplans/search', 'GET', {
        city: query.city || '',
        communityName,
        area: query.area || '',
        layout: query.layout || '',
        page: 1,
        limit: 10
      });

      const results = (res.data || []).map(item => ({
        ...item,
        displayArea: item.area ? `${item.area}㎡` : '面积未知',
        displayLayout: item.layoutLabel || '户室待确认'
      }));

      this.setData({
        kujialeResults: results,
        kujialeError: results.length ? '' : '未找到匹配户型，可继续使用模板或现场测绘'
      });
    } catch (err) {
      console.error('Search KuJiale floor plans failed:', err);
      this.setData({
        kujialeResults: [],
        kujialeError: (err && err.error) || '酷家乐户型搜索失败，请稍后重试'
      });
    } finally {
      this.setData({ kujialeLoading: false });
    }
  },

  async onImportKujiale(e) {
    const externalId = e.currentTarget.dataset.id;
    if (!externalId || this.data.kujialeImportingId) return;

    this.setData({ kujialeImportingId: externalId });
    wx.showLoading({ title: '导入户型...' });

    try {
      const res = await api.request(`/leads/${this.data.leadId}/floorplans/kujiale`, 'POST', {
        externalId
      });

      if (res.success) {
        wx.showToast({ title: '户型已导入', icon: 'success' });
        await this.fetchLeadDetail();
      }
    } catch (err) {
      console.error('Import KuJiale floor plan failed:', err);
      wx.showToast({ title: (err && err.error) || '导入失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ kujialeImportingId: '' });
    }
  },

  async onSelectTemplate(e) {
    const templateId = e.currentTarget.dataset.id;
    const roomsData = templatesUtil.generateTemplateRooms(templateId);
    const layoutData = wholeHomeGeometry.createEmptyLayout(roomsData);

    wx.showLoading({ title: '创建户型...' });
    try {
      const payload = {
        openid: app.globalData.openid,
        name: `${this.data.lead.name} 的户型 - ` + util.formatTime(new Date()).split(' ')[0].replace(/\//g, ''),
        layoutData,
        source: 'template',
        status: 'draft'
      };

      const fpRes = await api.request('/floorplans', 'POST', payload);

      if (fpRes.success && fpRes.data) {
        await api.request(`/leads/${this.data.leadId}`, 'PUT', {
          openid: app.globalData.openid,
          floorPlanId: fpRes.data._id
        });

        wx.hideLoading();
        wx.showToast({ title: '创建成功' });
        this.fetchLeadDetail();
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  async ensureWholeHomeFloorPlan() {
    if (this.data.activeFloorPlan) {
      const parsed = wholeHomeGeometry.parseLayoutData(this.data.activeFloorPlan.layoutData);
      if (parsed.measurementMode === 'whole_home') return this.data.activeFloorPlan;

      const layoutData = {
        ...wholeHomeGeometry.createEmptyLayout(parsed.rooms || []),
        rooms: parsed.rooms || []
      };
      const res = await api.request(`/floorplans/${this.data.activeFloorPlan._id}`, 'PUT', {
        openid: app.globalData.openid,
        name: this.data.activeFloorPlan.name,
        layoutData,
        status: this.data.activeFloorPlan.status || 'draft'
      });
      return res.success ? { ...this.data.activeFloorPlan, layoutData } : this.data.activeFloorPlan;
    }

    const layoutData = wholeHomeGeometry.createEmptyLayout([]);
    const fpRes = await api.request('/floorplans', 'POST', {
      openid: app.globalData.openid,
      name: `${this.data.lead.name} 的全屋测量 - ` + util.formatTime(new Date()).split(' ')[0].replace(/\//g, ''),
      layoutData,
      source: 'manual',
      status: 'draft'
    });

    if (fpRes.success && fpRes.data) {
      await api.request(`/leads/${this.data.leadId}`, 'PUT', {
        openid: app.globalData.openid,
        floorPlanId: fpRes.data._id
      });
      return fpRes.data;
    }

    return null;
  },

  async onStartWholeHomeMeasure() {
    wx.showLoading({ title: '准备全屋测量...' });
    try {
      const floorPlan = await this.ensureWholeHomeFloorPlan();
      wx.hideLoading();
      if (!floorPlan) {
        wx.showToast({ title: '创建户型失败', icon: 'none' });
        return;
      }

      const parsed = wholeHomeGeometry.parseLayoutData(floorPlan.layoutData);
      app.globalData.restoreFloorPlan = {
        _id: floorPlan._id,
        layoutData: floorPlan.layoutData,
        measurementMode: 'whole_home',
        wholeHomeStage: parsed.homeOutline && parsed.homeOutline.polygonClosed ? 'partition' : 'height',
        guidedMode: !(parsed.homeOutline && parsed.homeOutline.polygonClosed),
        showMeasurePrompt: !(parsed.homeOutline && parsed.homeOutline.polygonClosed),
        activeTool: 'SELECT',
        selectedIds: [],
        showPropertyPanel: false
      };

      wx.navigateTo({ url: '/pages/editor/editor' });
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '无法开始测量', icon: 'none' });
    }
  },

  onStartSurveyingPrototype() {
    const prototypePlan = this.data.surveyingPrototypePlan || null;
    const prototypeLayout = prototypePlan ? parseLayoutObject(prototypePlan.layoutData) : null;
    app.globalData.surveyingPrototypeContext = {
      leadId: this.data.leadId,
      leadName: this.data.lead && this.data.lead.name,
      floorPlanId: prototypePlan && prototypePlan._id,
      surveyDraft: prototypeLayout && prototypeLayout.surveyDraft,
      source: 'lead-detail'
    };

    const floorPlanQuery = prototypePlan && prototypePlan._id ? `&floorPlanId=${prototypePlan._id}` : '';
    wx.navigateTo({
      url: `/pages/surveying-editor/surveying-editor?leadId=${this.data.leadId || ''}${floorPlanQuery}`
    });
  },

  onEnterRoom(e) {
    const roomId = e.currentTarget.dataset.id;
    let targetRoom = null;

    for (let r of this.data.rooms) {
      if (r.id === roomId) {
        targetRoom = r; break;
      }
    }

    if (!targetRoom || !this.data.activeFloorPlan) return;

    const parsed = wholeHomeGeometry.parseLayoutData(this.data.activeFloorPlan.layoutData);

    app.globalData.restoreFloorPlan = {
      _id: this.data.activeFloorPlan._id,
      roomId: roomId,
      roomName: targetRoom.name,
      layoutData: parsed.measurementMode === 'whole_home' ? this.data.activeFloorPlan.layoutData : this.data.rooms,
      measurementMode: parsed.measurementMode,
      guidedMode: parsed.measurementMode === 'whole_home' ? false : true,
      showMeasurePrompt: parsed.measurementMode === 'whole_home' ? false : !targetRoom.measured,
      activeTool: 'SELECT',
      selectedIds: [roomId],
      showPropertyPanel: parsed.measurementMode === 'whole_home'
    };

    wx.navigateTo({ url: '/pages/editor/editor' });
  },

  onAddRoom() {
    if (!this.data.activeFloorPlan) return;
    const parsed = wholeHomeGeometry.parseLayoutData(this.data.activeFloorPlan.layoutData);
    const newRooms = [...this.data.rooms];
    newRooms.push({
      id: util.generateUUID(),
      name: '新增房间',
      measured: false,
      color: 'rgba(255, 255, 255, 0.8)',
      defaultWidth: 40,
      defaultHeight: 40
    });

    const layoutData = parsed.measurementMode === 'whole_home'
      ? Object.assign({}, parsed, { rooms: newRooms, draftState: parsed.draftState || null })
      : newRooms;

    wx.showLoading({ title: '添加中...' });
    api.request(`/floorplans/${this.data.activeFloorPlan._id}`, 'PUT', {
      openid: app.globalData.openid,
      name: this.data.activeFloorPlan.name,
      layoutData,
      status: this.data.activeFloorPlan.status || 'draft'
    }).then(res => {
      wx.hideLoading();
      if (res.success) {
        this.fetchLeadDetail();
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  }
});
