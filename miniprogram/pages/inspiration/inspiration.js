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
    if (!item || !item.layoutData) return;

    wx.showModal({
      title: '一键复刻',
      content: `是否要在画布中应用“${item.title}”的户型结构？`,
      success: (res) => {
        if (res.confirm) {
          const app = getApp();
          // 构造一个类似 FloorPlan 的结构供 index.js 还原
          app.globalData.restoreFloorPlan = {
            name: item.title + ' (复刻)',
            layoutData: item.layoutData
          };

          // 切换到量房 Tab (通常是第0个)
          wx.switchTab({
            url: '/pages/index/index'
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
