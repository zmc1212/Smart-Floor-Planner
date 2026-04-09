/**
 * AI 渲染服务 - Pollinations 免费端点
 */

/**
 * 生成 AI 效果图
 * @param {string} roomName 房间名
 * @param {string} style 装修风格
 * @param {number} width 宽度(px)
 * @param {number} height 高度(px)
 * @param {number} height 高度(px)
 * @param {Array} openings 门窗列表
 * @param {string} mode 模式: 'INTERIOR' | 'PLANE'
 * @returns {Promise<string>} 图片URL
 */
function generateRendering(roomName, style, width, height, openings, mode, polygon) {
  openings = openings || [];

  // 确定形状描述
  var shapeDesc = '';
  if (polygon && polygon.length >= 4) {
    var edgeCount = polygon.length;
    if (edgeCount === 4) {
      shapeDesc = 'rectangular ';
    } else if (edgeCount === 6) {
      shapeDesc = 'L-shaped ';
    } else if (edgeCount === 8) {
      shapeDesc = 'T-shaped or U-shaped ';
    } else {
      shapeDesc = edgeCount + '-sided polygon-shaped ';
    }
  }

  var wallMap = { 'Top': [], 'Right': [], 'Bottom': [], 'Left': [] };

  openings.forEach(function (o) {
    var type = o.type === 'DOOR' ? 'Door' : 'Window';
    var widthM = (o.width / 10).toFixed(1);
    var distFromStart = (o.rotation === 0) ? (o.x / 10).toFixed(1) : (o.y / 10).toFixed(1);
    var wallName = '';
    if (o.rotation === 0) {
      wallName = o.y < (height / 2) ? 'Top' : 'Bottom';
    } else {
      wallName = o.x < (width / 2) ? 'Left' : 'Right';
    }
    wallMap[wallName].push(type + ' [width: ' + widthM + 'm, offset: ' + distFromStart + 'm]');
  });

  var layoutDetails = Object.keys(wallMap)
    .filter(function (w) { return wallMap[w].length > 0; })
    .map(function (w) { return w + ' Wall: ' + wallMap[w].join('; '); })
    .join(' | ');

  var prompt = '';
  if (mode === 'PLANE') {
    // 平面图模式：强调 2D、线条、技术感
    prompt = '2D technical floor plan, professional architectural drawing of ' + shapeDesc + roomName + ', ' + style + ' style. ' +
      'Dimensions: ' + (width / 10).toFixed(2) + 'm x ' + (height / 10).toFixed(2) + 'm. ' +
      'Layout: ' + (layoutDetails || 'Standard room') + '. ' +
      'Style: Orthographic top-down, clean white background, drafting pen lines, strictly no text, no fonts, no numbers.';
  } else {
    // 构建室内场景描述
    var wallDescriptions = [];
    if (wallMap['Top'].length > 0) wallDescriptions.push('On the far wall (front): ' + wallMap['Top'].join(', '));
    if (wallMap['Left'].length > 0) wallDescriptions.push('On the left wall: ' + wallMap['Left'].join(', '));
    if (wallMap['Right'].length > 0) wallDescriptions.push('On the right wall: ' + wallMap['Right'].join(', '));
    if (wallMap['Bottom'].length > 0) wallDescriptions.push('Note: ' + wallMap['Bottom'].join(', ') + ' are behind the viewer.');

    // 装修效果图模式：基于用户反馈深度优化视角和“去文字化”
    prompt = 'Hyper-photorealistic interior rendering of a ' + style + ' ' + shapeDesc + roomName + '. ' +
      'View: Eye-level perspective looking straight at the far wall. ' +
      'Spatial Map: ' + wallDescriptions.join('. ') + '. ' +
      'Furniture: Modern sofa near window/far wall, TV console on side wall. ' +
      'Visuals: 8k resolution, cinematic lighting with sun-rays, high-end architectural photography, strictly NO text, NO numbers, NO dimension lines, NO labels, clean walls.';
  }

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
