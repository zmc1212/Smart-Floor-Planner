const TEMPLATE_ID = 'j6WMWNX3_-NKfuZPs7XuHYz91EymYKcnob1uDziK5f4';

function requestNotification() {
  return new Promise((resolve, reject) => {
    if (!wx.requestSubscribeMessage) {
      wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
      return resolve(false);
    }

    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success(res) {
        if (res[TEMPLATE_ID] === 'accept') {
          wx.showToast({ title: '通知已开启', icon: 'success' });
          resolve(true);
        } else {
          wx.showToast({ title: '未开启通知', icon: 'none' });
          resolve(false);
        }
      },
      fail(err) {
        if (err.errCode === 20004) {
          wx.showModal({
            title: '开启通知',
            content: '请在设置中开启消息通知，否则无法接收任务提醒。',
            confirmText: '去开启',
            success(modalRes) {
              if (modalRes.confirm) wx.openSetting();
            }
          });
        }
        reject(err);
      }
    });
  });
}

module.exports = {
  requestNotification,
  TEMPLATE_ID
};
