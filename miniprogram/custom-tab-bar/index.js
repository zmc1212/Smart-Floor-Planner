Component({
  data: {
    selected: 0,
    list: [
      { key: 'home', pagePath: '/pages/index/index', text: '首页', iconPath: '/images/meaure0.png', selectedIconPath: '/images/meaure1.png' },
      { key: 'leads', pagePath: '/pages/leads-management/leads-management', text: '线索', iconPath: '/images/mine0.png', selectedIconPath: '/images/mine1.png' },
      { key: 'measure', pagePath: '/pages/index/index', text: '量房', iconPath: '/images/meaure1.png', selectedIconPath: '/images/meaure1.png', center: true },
      { key: 'inspiration', pagePath: '/pages/inspiration/inspiration', text: '灵感', iconPath: '/images/idea0.png', selectedIconPath: '/images/idea1.png' },
      { key: 'mine', pagePath: '/pages/mine/mine', text: '我的', iconPath: '/images/mine0.png', selectedIconPath: '/images/mine1.png' }
    ]
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item) return;

      wx.switchTab({ url: item.pagePath });
    },

    syncSelected() {
      const pages = getCurrentPages();
      const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
      const index = this.data.list.findIndex((item) => item.pagePath === current && !item.center);
      this.setData({ selected: index >= 0 ? index : this.data.selected });
    }
  }
});
