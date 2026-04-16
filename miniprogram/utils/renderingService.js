const api = require('./api.js');

/**
 * 生成 AI 效果图 (通过后端代理)
 */
function generateRendering(roomName, style, width, height, openings, mode, polygon) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await api.request('/ai/render', 'POST', {
        roomName, style, width, height, openings, mode, polygon
      });

      if (res.success && res.url) {
        // 下载图片到小程序本地临时文件
        wx.downloadFile({
          url: res.url,
          success: function (downloadRes) {
            if (downloadRes.statusCode === 200) {
              resolve(downloadRes.tempFilePath);
            } else {
              reject(new Error('下载效果图失败，状态码: ' + downloadRes.statusCode));
            }
          },
          fail: function (err) {
            console.error('downloadFile fail:', err);
            reject(new Error('网络错误，无法生成效果图'));
          }
        });
      } else {
        reject(new Error(res.error || '生成效果图失败'));
      }
    } catch (err) {
      console.error('AI Render API failed:', err);
      reject(new Error('无法连接 AI 服务，请检查网络'));
    }
  });
}

/**
 * 生成 AI 装修建议 (通过后端代理)
 */
function generateDesignAdvice(roomName, style, width, height) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await api.request('/ai/advice', 'POST', {
        roomName, style, width, height
      });

      if (res.success && res.advice) {
        resolve(res.advice);
      } else {
        reject(new Error(res.error || '无法生成建议。'));
      }
    } catch (err) {
      console.error('AI Advice API failed:', err);
      reject(new Error('无法获取 AI 装修建议，请稍后再试。'));
    }
  });
}

module.exports = {
  generateRendering: generateRendering,
  generateDesignAdvice: generateDesignAdvice
};
