const app = getApp();
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const templatesUtil = require('../../utils/templates.js');

Page({
  data: {
    leadId: null,
    lead: null,
    templates: templatesUtil.templates,
    loading: true,
    activeFloorPlan: null,
    rooms: []
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

        // Get the latest floor plan
        if (lead.floorPlanIds && lead.floorPlanIds.length > 0) {
          activeFloorPlan = lead.floorPlanIds[lead.floorPlanIds.length - 1];
          if (activeFloorPlan && activeFloorPlan.layoutData) {
            let parsed = activeFloorPlan.layoutData;
            if (typeof parsed === 'string') {
              try { parsed = JSON.parse(parsed); } catch(e) {}
            }
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              rooms = parsed.rooms || [];
            } else {
              rooms = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            }
          }
        }

        this.setData({ lead, activeFloorPlan, rooms, loading: false });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async onSelectTemplate(e) {
    const templateId = e.currentTarget.dataset.id;
    const roomsData = templatesUtil.generateTemplateRooms(templateId);
    
    wx.showLoading({ title: '创建户型项目...' });
    try {
      const payload = {
        openid: app.globalData.openid,
        name: `${this.data.lead.name} 的户型 - ` + util.formatTime(new Date()).split(' ')[0].replace(/\//g, ''),
        layoutData: roomsData,
        status: 'draft'
      };
      
      const fpRes = await api.request('/floorplans', 'POST', payload);
      
      if (fpRes.success && fpRes.data) {
        // Bind to lead
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

  onEnterRoom(e) {
    const roomId = e.currentTarget.dataset.id;
    let targetRoom = null;
    
    for (let r of this.data.rooms) {
      if (r.id === roomId) {
        targetRoom = r; break;
      }
    }
    
    if (!targetRoom || !this.data.activeFloorPlan) return;

    // Convert layoutData to the staggered grid like index.js does if needed,
    // but the backend already saved them. We just pass the entire rooms array.
    const canvasWidth = wx.getSystemInfoSync().windowWidth;
    const canvasHeight = wx.getSystemInfoSync().windowHeight - 150; 

    // Update positions if they are default (x, y = 0,0) to spread them out
    const updatedRooms = this.data.rooms.map((r, idx) => {
      if (r.x === undefined || (r.x === 0 && r.y === 0 && idx > 0)) {
        let roomW = r.defaultWidth || 40;
        let roomH = r.defaultHeight || 40;
        let offsetX = (idx % 2 === 0) ? (idx * 25) : -(idx * 25);
        let offsetY = (idx * 20);
        return {
          ...r,
          x: (canvasWidth / 2) - (roomW / 2) + offsetX,
          y: (canvasHeight / 2) - (roomH / 2) + 20 + offsetY,
          width: roomW,
          height: roomH
        };
      }
      return r;
    });

    var fpData = {
      _id: this.data.activeFloorPlan._id,
      roomId: roomId,
      roomName: targetRoom.name,
      layoutData: updatedRooms,
      guidedMode: true,
      showMeasurePrompt: !targetRoom.measured,
      activeTool: 'SELECT',
      selectedIds: [roomId],
      showPropertyPanel: false
    };

    app.globalData.restoreFloorPlan = fpData;

    wx.navigateTo({
      url: '/pages/editor/editor'
    });
  },

  onAddRoom() {
    if (!this.data.activeFloorPlan) return;
    const newRooms = [...this.data.rooms];
    newRooms.push({
      id: util.generateUUID(),
      name: '新增房间',
      measured: false,
      color: 'rgba(255, 255, 255, 0.8)',
      defaultWidth: 40,
      defaultHeight: 40
    });
    
    wx.showLoading({ title: '添加中...' });
    api.request(`/floorplans/${this.data.activeFloorPlan._id}`, 'PUT', {
      openid: app.globalData.openid,
      layoutData: newRooms
    }).then(res => {
      wx.hideLoading();
      if (res.success) {
        this.fetchLeadDetail();
      }
    });
  }
});