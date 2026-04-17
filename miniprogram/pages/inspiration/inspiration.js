const util = require('../../utils/util.js');
const api = require('../../utils/api.js');

Page({
  data: {
    cases: [],
    styleMetadata: util.StyleMetadata,
    selectedStyle: 'all',
    selectedRoomType: '全部',
    roomTypes: ['全部', '客厅', '主卧', '次卧', '书房', '餐厅', '厨房', '卫生间', '阳台'],
    isLoading: false,
    isRefreshing: false,
    hasMore: true,
    page: 1,
    showLeadModal: false,
    showPoster: false,
    currentCase: null
  },

  onLoad: function () {
    this.fetchCases();
  },

  onRefresh: function () {
    this.setData({ 
      page: 1, 
      hasMore: true, 
      isRefreshing: true 
    }, () => {
      this.fetchCases(true);
    });
  },

  onLoadMore: function () {
    if (this.data.isLoading || !this.data.hasMore) return;
    this.setData({ page: this.data.page + 1 }, () => {
      this.fetchCases();
    });
  },

  fetchCases: async function (isReplace = false) {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      let url = `/inspirations?page=${this.data.page}`;
      if (this.data.selectedStyle !== 'all') {
        url += `&style=${encodeURIComponent(this.data.selectedStyle)}`;
      }
      if (this.data.selectedRoomType !== '全部') {
        url += `&roomType=${encodeURIComponent(this.data.selectedRoomType)}`;
      }

      const res = await api.request(url, 'GET');
      
      if (res.success && res.data) {
        // 模拟占位颜色 (由于目前没图)
        const newCases = res.data.map(item => ({
          ...item,
          placeholderColor: this.getRandomColor(item.style)
        }));

        this.setData({
          cases: isReplace ? newCases : this.data.cases.concat(newCases),
          hasMore: res.data.length >= 10, // 假设每页10条
          isLoading: false,
          isRefreshing: false
        });
      } else {
        this.setData({ isLoading: false, isRefreshing: false });
      }
    } catch (err) {
      console.error('Fetch cases failed:', err);
      this.setData({ isLoading: false, isRefreshing: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onFilterStyle: function (e) {
    const style = e.currentTarget.dataset.style;
    if (this.data.selectedStyle === style) return;
    
    this.setData({
      selectedStyle: style,
      page: 1,
      hasMore: true,
      cases: []
    }, () => {
      this.fetchCases(true);
    });
  },

  onFilterRoomType: function (e) {
    const roomType = e.currentTarget.dataset.type;
    if (this.data.selectedRoomType === roomType) return;
    
    this.setData({
      selectedRoomType: roomType,
      page: 1,
      hasMore: true,
      cases: []
    }, () => {
      this.fetchCases(true);
    });
  },

  getRandomColor: function (style) {
    const meta = util.StyleMetadata.find(m => m.label === style);
    return meta ? meta.color : '#f1f5f9';
  },

  onCopyLayout: function (e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.cases.find(c => c._id === id);
    
    if (!item) {
      wx.showToast({ title: '案例找不到了', icon: 'none' });
      return;
    }

    let layoutData = item.layoutData;
    // 兼容可能被存为字符串的 JSON 数据
    if (typeof layoutData === 'string') {
      try {
        layoutData = JSON.parse(layoutData);
      } catch (err) {
        console.error('解析户型数据失败:', err);
        wx.showToast({ title: '数据格式有误', icon: 'none' });
        return;
      }
    }

    if (!layoutData || (Array.isArray(layoutData) && layoutData.length === 0)) {
      wx.showToast({ title: '该案例暂无户型布局', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '一键复刻',
      content: `是否要在画布中应用“${item.title}”的户型结构？\n这会覆盖您当前正在绘制的内容。`,
      confirmText: '确认复刻',
      success: (res) => {
        if (res.confirm) {
          const app = getApp();
          const util = require('../../utils/util.js');

          // 1. 数据抽取：兼容 Array 格式 or { rooms: [] } 格式
          let finalRooms = [];
          if (Array.isArray(layoutData)) {
            finalRooms = layoutData;
          } else if (layoutData.rooms && Array.isArray(layoutData.rooms)) {
            finalRooms = layoutData.rooms;
          } else {
            // 如果只有单个对象且不是数组，封装为数组
            finalRooms = [layoutData];
          }

          // 2. 数据清洗：确保每个房间都有 ID 和基础属性
          finalRooms = finalRooms.map(r => {
            // 基础属性强制转换
            const newRoom = {
              id: r.id || util.generateUUID(),
              name: r.name || '未命名房间',
              x: Number(r.x) || 0,
              y: Number(r.y) || 0,
              width: Number(r.width) || 0,
              height: Number(r.height) || 0,
              color: r.color || 'rgba(255, 255, 255, 0.8)',
              openings: Array.isArray(r.openings) ? r.openings : [],
              measured: r.measured || (r.polygon && r.polygon.length > 0) || false,
              polygon: []
            };

            // 处理多边形顶点及其数值类型
            if (r.polygon && Array.isArray(r.polygon)) {
              newRoom.polygon = r.polygon.map(p => ({
                x: Number(p.x) || 0,
                y: Number(p.y) || 0
              }));
              newRoom.polygonClosed = r.polygonClosed !== false; // 默认闭合
            }

            // 关键修复：如果缺少宽/高但有多边形，则计算包围盒宽高
            if ((!newRoom.width || !newRoom.height) && newRoom.polygon.length > 0) {
              const bbox = util.polygonBoundingBox(newRoom.polygon);
              newRoom.width = bbox.width;
              newRoom.height = bbox.height;
            } else if (!newRoom.width || !newRoom.height) {
              newRoom.width = 40;
              newRoom.height = 40;
            }
            
            return newRoom;
          });

          app.globalData.restoreFloorPlan = {
            name: item.title + ' (复刻)',
            layoutData: finalRooms
          };

          console.log('一键同款数据准备就绪:', app.globalData.restoreFloorPlan);

          // 3. 页面跳转
          wx.switchTab({
            url: '/pages/index/index',
            success: () => {
              wx.showToast({ title: '已应用布局', icon: 'success' });
            }
          });
        }
      }
    });
  },

  onPreviewCase: function (e) {
    // 暂时直接预览效果图
    const id = e.currentTarget.dataset.id;
    const item = this.data.cases.find(c => c._id === id);
    if (item && item.renderingImage) {
      wx.previewImage({
        urls: [item.renderingImage]
      });
    }
  },

  onOpenLeadModal: function () {
    this.setData({ showLeadModal: true });
  },

  onCloseLeadModal: function () {
    this.setData({ showLeadModal: false });
  },

  onLeadSuccess: function () {
    wx.showToast({ title: '预约成功', icon: 'success' });
  },

  onOpenPoster: function (e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.cases.find(c => c._id === id);
    if (item) {
      this.setData({
        currentCase: item,
        showPoster: true
      });
    }
  },

  onClosePoster: function () {
    this.setData({ showPoster: false });
  }
});
