/**
 * 微信订阅消息工具类
 */
const TEMPLATE_ID = 'j6WMWNX3_-NKfuZPs7XuHYz91EymYKcnob1uDziK5f4';

const requestNotification = () => {
  return new Promise((resolve, reject) => {
    if (!wx.requestSubscribeMessage) {
      console.error('当前微信版本不支持订阅消息');
      return resolve(false);
    }

    wx.requestSubscribeMessage({
      tmplIds: [TEMPLATE_ID],
      success(res) {
        if (res[TEMPLATE_ID] === 'accept') {
          console.log('用户同意订阅消息');
          wx.showToast({ title: '通知已开启', icon: 'success' });
          resolve(true);
        } else {
          console.log('用户拒绝订阅消息');
          resolve(false);
        }
      },
      fail(err) {
        console.error('订阅消息请求失败', err);
        // 如果是 20004 错误，表示用户关闭了主开关，需要引导去设置页
        if (err.errCode === 20004) {
          wx.showModal({
            title: '提示',
            content: '请在设置中开启“消息通知”，否则无法接收任务提醒',
            confirmText: '去开启',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting();
              }
            }
          });
        }
        reject(err);
      }
    });
  });
};

module.exports = {
  requestNotification,
  TEMPLATE_ID
};
