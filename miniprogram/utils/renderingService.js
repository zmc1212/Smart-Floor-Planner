/**
 * AI 渲染服务 - Pollinations 免费端点
 */

/**
 * 生成 AI 效果图
 * @param {string} roomName 房间名
 * @param {string} style 装修风格
 * @param {number} width 宽度(px)
 * @param {number} height 高度(px)
 * @param {Array} openings 门窗列表
 * @returns {Promise<string>} 图片URL
 */
function generateRendering(roomName, style, width, height, openings) {
  openings = openings || [];

  var openingsDescription = openings.map(function (o) {
    var type = o.type === 'DOOR' ? 'Door' : 'Window';
    var pos = o.rotation === 0
      ? (o.y < 5 ? 'Top' : 'Bottom') + ' wall (x=' + (o.x / 10).toFixed(1) + 'm)'
      : (o.x < 5 ? 'Left' : 'Right') + ' wall (y=' + (o.y / 10).toFixed(1) + 'm)';
    return type + ' on ' + pos;
  }).join(', ');

  var prompt = 'Interior design collage: ' + roomName + ', ' + style + ' style, ' +
    (width / 10) + 'x' + (height / 10) + 'm. ' +
    'Layout: ' + (openingsDescription || 'Standard enclosed space') + '. ' +
    'Views: 3D top-down plan, entrance perspective, detail shot. ' +
    'Style: Photorealistic, 8k, architectural photography, cinematic lighting, white background. ' +
    'Strictly NO TEXT, NO LABELS, NO NUMBERS.';

  var encodedPrompt = encodeURIComponent(prompt);
  var seed = Math.floor(Math.random() * 1000000);
  var model = 'flux';

  var params = 'model=' + model + '&width=1024&height=1024&nologo=true&enhance=true&seed=' + seed;
  var url = 'https://image.pollinations.ai/prompt/' + encodedPrompt + '?' + params;

  return new Promise(function (resolve, reject) {
    // 下载图片到小程序本地临时文件
    wx.downloadFile({
      url: url,
      success: function (res) {
        if (res.statusCode === 200) {
          resolve(res.tempFilePath);
        } else {
          reject(new Error('下载效果图失败，状态码: ' + res.statusCode));
        }
      },
      fail: function (err) {
        console.error('downloadFile fail:', err);
        reject(new Error('网络错误，无法生成效果图'));
      }
    });
  });
}

/**
 * 生成 AI 装修建议
 * @param {string} roomName 房间名
 * @param {string} style 装修风格
 * @param {number} width 宽度(px)
 * @param {number} height 高度(px)
 * @returns {Promise<string>} 建议文本
 */
function generateDesignAdvice(roomName, style, width, height) {
  var systemPrompt = 'You are a professional interior design consultant. Provide concise, expert advice for a room based on its type, dimensions, and style. Focus on furniture layout, color palettes, and lighting. Use bullet points and keep it under 150 words. Respond in Chinese.';
  var userPrompt = 'Room: ' + roomName + ', Style: ' + style + ', Dimensions: ' + (width / 10) + 'm x ' + (height / 10) + 'm!';

  var url = 'https://gen.pollinations.ai/v1/chat/completions';

  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
      data: {
        model: 'gemini-fast',
        messages: [
          { role: 'user', content: systemPrompt + userPrompt }
        ]
      },
      success: function (res) {
        if (res.statusCode === 200 && res.data && res.data.choices) {
          var content = res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
          resolve(content || '无法生成建议。');
        } else {
          reject(new Error('AI 建议接口返回异常'));
        }
      },
      fail: function (err) {
        console.error('request fail:', err);
        reject(new Error('无法获取 AI 装修建议，请稍后再试。'));
      }
    });
  });
}

module.exports = {
  generateRendering: generateRendering,
  generateDesignAdvice: generateDesignAdvice
};
