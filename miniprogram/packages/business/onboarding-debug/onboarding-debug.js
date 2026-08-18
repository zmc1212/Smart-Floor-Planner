const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';

function isDevelopmentBuild() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
  } catch (error) {
    return false;
  }
}

function scannedOnboardingUrl(scanResult) {
  const rawPath = String(scanResult && scanResult.path || '').trim();
  const queryIndex = rawPath.indexOf('?');
  const route = (queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex))
    .replace(/^\/+/, '');
  if (route !== ONBOARDING_ROUTE) return '';
  return `/${ONBOARDING_ROUTE}${queryIndex === -1 ? '' : rawPath.slice(queryIndex)}`;
}

Page({
  data: {
    isDevelopment: false,
    errorMessage: ''
  },

  onLoad() {
    this.setData({ isDevelopment: isDevelopmentBuild() });
  },

  selectOnboardingCode() {
    if (!this.data.isDevelopment) return;
    this.setData({ errorMessage: '' });
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (result) => {
        const url = scannedOnboardingUrl(result);
        if (!url) {
          this.setData({ errorMessage: '请选择本企业生成的员工或推荐人入驻小程序码。' });
          return;
        }
        wx.navigateTo({
          url,
          fail: () => this.setData({ errorMessage: '无法打开入驻页，请重新选择小程序码。' })
        });
      },
      fail: (error) => {
        if (String(error && error.errMsg || '').includes('cancel')) return;
        this.setData({ errorMessage: '识别小程序码失败，请确认选择的是下载的入驻码图片。' });
      }
    });
  }
});
