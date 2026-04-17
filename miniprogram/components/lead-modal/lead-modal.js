const api = require('../../utils/api.js');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    formData: {
      name: '',
      phone: '',
      area: '',
      stylePreference: ''
    },
    styleOptions: ['现代简约', '北欧风', '新中式', '法式奶油', '日式侘寂', '美式复古', '轻奢风', '其他'],
    loading: false
  },

  lifetimes: {
    attached() {
      this.initUserInfo();
    }
  },

  observers: {
    'show': function(show) {
      if (show) {
        this.initUserInfo();
      }
    }
  },

  methods: {
    initUserInfo() {
      const app = getApp();
      const userInfo = app.globalData.userInfo;
      if (userInfo) {
        this.setData({
          'formData.name': userInfo.name || userInfo.nickName || '',
          'formData.phone': userInfo.phone || userInfo.phoneNumber || ''
        });
      }
    },

    onInput(e) {
      const field = e.currentTarget.dataset.field;
      const value = e.detail.value;
      this.setData({
        [`formData.${field}`]: value
      });
    },

    onClose() {
      this.setData({ show: false });
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.onClose();
    },

    onContainerTap() {
      // Prevent event bubbling to mask
    },

    onStyleChange(e) {
      const index = e.detail.value;
      this.setData({
        'formData.stylePreference': this.data.styleOptions[index]
      });
    },

    async onSubmit() {
      const { name, phone, area, stylePreference } = this.data.formData;
      
      if (!name.trim()) {
        wx.showToast({ title: '请输入姓名', icon: 'none' });
        return;
      }
      if (!phone.trim() || !/^1[3-9]\d{9}$/.test(phone)) {
        wx.showToast({ title: '请输入有效的手机号', icon: 'none' });
        return;
      }

      this.setData({ loading: true });

      const app = getApp();
      const { enterpriseId, staffId } = app.globalData.referral;

      try {
        const res = await api.request('/leads', 'POST', {
          name,
          phone,
          area: area ? parseFloat(area) : undefined,
          stylePreference,
          source: 'miniprogram',
          enterpriseId: enterpriseId || undefined,
          assignedTo: staffId || undefined
        });

        if (res.success) {
          wx.showToast({ title: '提交成功，我们会尽快联系您！', icon: 'none', duration: 2000 });
          this.setData({ 
            formData: { name: '', phone: '', area: '', stylePreference: '' },
            show: false 
          });
          this.triggerEvent('success');
        } else {
          wx.showToast({ title: res.error || '提交失败，请重试', icon: 'none' });
        }
      } catch (err) {
        console.error('Submit lead error:', err);
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    }
  }
})
