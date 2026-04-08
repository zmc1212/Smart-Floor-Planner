var util = require('../../utils/util.js');
var renderingService = require('../../utils/renderingService.js');

var StyleType = util.StyleType;

Page({
  data: {
    room: null,
    selectedStyle: StyleType.MODERN,
    styles: Object.values(StyleType),
    selectedMode: 'INTERIOR', // 'INTERIOR' | 'PLANE'
    isGenerating: false,
    isGettingAdvice: false
  },

  onLoad: function () {
    const app = getApp();
    const room = app.globalData.currentAIGenRoom;
    
    if (room) {
      this.setData({ room: room });
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 2000);
    }
  },

  onStyleSelect: function (e) {
    this.setData({ selectedStyle: e.currentTarget.dataset.style });
  },

  onModeChange: function (e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ selectedMode: mode });
    // 增加反馈
    wx.vibrateShort();
    wx.showToast({ 
      title: mode === 'INTERIOR' ? '已切换为效果图' : '已切换为平面图',
      icon: 'none',
      duration: 1000
    });
  },

  onGenerate: function () {
    if (this.data.isGenerating) return;
    var that = this;
    var room = this.data.room;

    this.setData({ isGenerating: true });

    renderingService.generateRendering(
      room.name,
      this.data.selectedStyle,
      room.width,
      room.height,
      room.openings || [],
      this.data.selectedMode
    ).then(function (url) {
      const updatedRoom = Object.assign({}, room, { renderingUrl: url });
      that.setData({ 
        room: updatedRoom,
        isGenerating: false 
      });
      that.syncBack(updatedRoom);
      wx.showToast({ title: '效果图已生成', icon: 'success' });
    }).catch(function (err) {
      wx.showToast({ title: err.message || '生成中...请稍候', icon: 'none' });
      that.setData({ isGenerating: false });
    });
  },

  onGetAdvice: function () {
    if (this.data.isGettingAdvice) return;
    var that = this;
    var room = this.data.room;

    this.setData({ isGettingAdvice: true });

    renderingService.generateDesignAdvice(
      room.name,
      this.data.selectedStyle,
      room.width,
      room.height
    ).then(function (advice) {
      const updatedRoom = Object.assign({}, room, { 
        designAdvice: {
          content: advice,
          timestamp: Date.now()
        } 
      });
      that.setData({ 
        room: updatedRoom,
        isGettingAdvice: false 
      });
      that.syncBack(updatedRoom);
    }).catch(function (err) {
      wx.showToast({ title: err.message || '获取建议失败', icon: 'none' });
      that.setData({ isGettingAdvice: false });
    });
  },

  onPreviewImage: function () {
    if (this.data.room.renderingUrl) {
      wx.previewImage({
        current: this.data.room.renderingUrl,
        urls: [this.data.room.renderingUrl]
      });
    }
  },

  onSaveImage: function () {
    if (!this.data.room.renderingUrl) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.room.renderingUrl,
      success: function () {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: function () {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  onBack: function () {
    wx.navigateBack();
  },

  onExportPrompt: function () {
    const room = this.data.room;
    const style = this.data.selectedStyle;
    const mode = this.data.selectedMode;
    const openings = room.openings || [];

    const wallMap = {
      'Top': [],
      'Right': [],
      'Bottom': [],
      'Left': []
    };

    openings.forEach(o => {
      const type = o.type === 'DOOR' ? 'Door' : 'Window';
      const widthM = (o.width / 10).toFixed(1);
      const distFromStart = (o.rotation === 0) ? (o.x / 10).toFixed(1) : (o.y / 10).toFixed(1);
      
      let wallName = '';
      if (o.rotation === 0) {
        wallName = o.y < (room.height / 2) ? 'Top' : 'Bottom';
      } else {
        wallName = o.x < (room.width / 2) ? 'Left' : 'Right';
      }
      
      const desc = `${type} [width: ${widthM}m, offset: ${distFromStart}m]`;
      wallMap[wallName].push(desc);
    });

    const layoutDetails = Object.keys(wallMap)
      .filter(w => wallMap[w].length > 0)
      .map(w => `${w} Wall: ${wallMap[w].join('; ')}`)
      .join(' | ');

    const modeReq = mode === 'PLANE' 
      ? '2D technical floor plan, architectural drawing, top-down orthographic view, blueprint aesthetic'
      : 'Realistic interior design rendering, perspective view, eye-level camera, cinematic lighting, photorealistic textures';

    const prompt = `Advanced Room Layout (Mapping):
Room Type: ${room.name}, Style: ${style}. 
Dimensions: ${(room.width / 10).toFixed(2)}m (W) x ${(room.height / 10).toFixed(2)}m (H). 
Architectural Map: ${layoutDetails || 'Enclosed area'}. 
Visual Mode: ${modeReq}.
Visual Specs: Professional photography, 8k, photorealistic, strictly no text.`;

    wx.setClipboardData({
      data: prompt,
      success: function () {
        wx.showToast({ title: '提示词已复制', icon: 'success' });
      }
    });
  },

  /**
   * 将更新后的数据同步并刷新全局/首页状态
   */
  syncBack: function (updatedRoom) {
    const pages = getCurrentPages();
    const indexPage = pages.find(p => p.route === 'pages/index/index');
    if (indexPage && indexPage.updateRoomData) {
      indexPage.updateRoomData(updatedRoom.id, updatedRoom);
    }
    // 同时也更新全局引用
    getApp().globalData.currentAIGenRoom = updatedRoom;
  }
});
