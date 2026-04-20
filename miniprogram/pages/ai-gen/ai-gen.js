var util = require('../../utils/util.js');
var renderingService = require('../../utils/renderingService.js');

var StyleType = util.StyleType;
var StyleMetadata = util.StyleMetadata;

Page({
  data: {
    room: null,
    selectedStyleKey: 'MODERN',
    selectedStyle: StyleType.MODERN,
    styles: Object.values(StyleType),
    styleMetadata: StyleMetadata,
    selectedMode: 'INTERIOR', // 'INTERIOR' | 'PLANE'
    isGenerating: false,
    isGettingAdvice: false,
    showLeadModal: false,
    showSharePoster: false,
    posterData: null
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
    const key = e.currentTarget.dataset.key;
    this.setData({ 
      selectedStyleKey: key,
      selectedStyle: StyleType[key]
    });
    // 触感反馈
    wx.vibrateShort();
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
      this.data.selectedMode,
      room.polygon || null
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
    const styleKey = this.data.selectedStyleKey;
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

    const modeReq = mode === 'PLANE' 
      ? '2D technical floor plan, architectural drawing, top-down orthographic view, blueprint aesthetic, clean black and white lines'
      : 'Photorealistic interior design rendering, eye-level perspective looking straight at the far wall, architectural photography';

    // 针对不同风格注入专有关键词
    const styleKeywords = {
      'MODERN': 'Clean lines, minimalism, high-end materials, neutral tones, functional furniture.',
      'CREAMY': 'Soft natural light, cream-colored palette, curved furniture, warm cozy atmosphere, bouclé fabric.',
      'NEW_CHINESE': 'Contemporary meets tradition, dark wood accents, Zen aesthetic, symmetrical layout, oriental porcelain.',
      'WABI_SABI:': 'Raw textures, microcement walls, aged wood, asymmetrical balance, organic shapes, earthy muted tones.',
      'NORDIC': 'Scandi design, light oak wood, pops of pastel, large plants, bright and airy, hygge vibe.',
      'LIGHT_LUXURY': 'Marble flooring, brass accents, velvet chairs, crystal chandelier, sophisticated and elegant.',
      'INDUSTRIAL': 'Exposed brick, metal pipes, leather sofa, concrete floor, dark moody studio vibe.',
      'JAPANDI': 'Fusion of Japanese and Scandi, low-profile furniture, rice paper lamps, clutter-free, light wood.'
    };

    const sceneDetails = [];
    if (wallMap['Top'].length > 0) sceneDetails.push(`Far wall: ${wallMap['Top'].join(', ')}.`);
    if (wallMap['Left'].length > 0) sceneDetails.push(`Left wall: ${wallMap['Left'].join(', ')}.`);
    if (wallMap['Right'].length > 0) sceneDetails.push(`Right wall: ${wallMap['Right'].join(', ')}.`);
    
    const furnitureHint = room.name.includes('客厅') 
      ? 'Place a premium sofa and a coffee table.'
      : (room.name.includes('卧室') ? 'A large comfortable bed with neat bedding.' : '');

    const prompt = `[PROMPT] ${modeReq}. 
Room: ${room.name} (${style} style). ${styleKeywords[styleKey] || ''}
Spatial layout: ${(room.width / 10).toFixed(2)}m x ${(room.height / 10).toFixed(2)}m. 
Openings: ${sceneDetails.join(' ')} 
Furniture: ${furnitureHint}
Visuals: 8k, photorealistic, cinematic lighting, professional interior photography, NO text, NO labels. [/PROMPT]`;

    wx.setClipboardData({
      data: prompt,
      success: function () {
        wx.showToast({ title: '提示词已复制', icon: 'success' });
      }
    });
  },

  syncBack: function (updatedRoom) {
    const pages = getCurrentPages();
    const indexPage = pages.find(p => p.route === 'pages/index/index');
    if (indexPage && indexPage.updateRoomData) {
      indexPage.updateRoomData(updatedRoom.id, updatedRoom);
    }
    getApp().globalData.currentAIGenRoom = updatedRoom;
  },

  onOpenLeadModal: function () {
    this.setData({ showLeadModal: true });
  },

  onCloseLeadModal: function () {
    this.setData({ showLeadModal: false });
  },

  onLeadSuccess: function () {
    console.log('Lead submitted successfully from ai-gen');
  },

  onOpenSharePoster: function () {
    const { room, selectedStyleKey, selectedMode } = this.data;
    const styleMetadata = StyleMetadata.find(s => s.key === selectedStyleKey) || {};
    
    this.setData({
      showSharePoster: true,
      posterData: {
        coverImage: room.renderingUrl,
        title: `${room.name} · AI 设计方案`,
        style: styleMetadata.label || '现代简约',
        roomType: room.name,
        area: (room.width * room.height / 100).toFixed(1) + '㎡'
      }
    });
  },

  onCloseSharePoster: function () {
    this.setData({ showSharePoster: false });
  }
});
