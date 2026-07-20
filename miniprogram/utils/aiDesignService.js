const api = require('./api.js');

function getToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function uploadToBaseUrl(baseUrl, filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/miniprogram/ai/assets`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${getToken()}` },
      success(res) {
        let payload = null;
        try { payload = JSON.parse(res.data || '{}'); } catch (error) { payload = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && payload && payload.success) {
          resolve(payload.data);
          return;
        }
        reject({ error: (payload && payload.error) || '图片上传失败', statusCode: res.statusCode });
      },
      fail: reject,
    });
  });
}

async function uploadAsset(filePath) {
  const baseUrls = api.getBaseUrls();
  let lastError = null;
  for (let index = 0; index < baseUrls.length; index += 1) {
    try {
      return await uploadToBaseUrl(baseUrls[index], filePath);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('图片上传失败');
}

function loadCapabilities() {
  return api.request('/miniprogram/ai/capabilities', 'GET').then((res) => res.data);
}

function loadSources() {
  return api.request('/miniprogram/ai/sources', 'GET').then((res) => res.data || []);
}

function loadWorkflows(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return api.request(`/miniprogram/ai/workflows${query ? `?${query}` : ''}`, 'GET').then((res) => res.data || []);
}

function createTask(payload) {
  return api.request('/miniprogram/ai/tasks', 'POST', payload).then((res) => res.data);
}

function runTask(id) {
  return api.request(`/miniprogram/ai/tasks/${id}/run`, 'POST', {}, { timeout: 120000 }).then((res) => res.data);
}

function getTask(id) {
  return api.request(`/miniprogram/ai/tasks/${id}`, 'GET').then((res) => res.data);
}

function retryTask(id) {
  return api.request(`/miniprogram/ai/tasks/${id}/retry`, 'POST').then((res) => res.data);
}

function loadHistory(page = 1, limit = 12) {
  return api.request(`/miniprogram/ai/history?page=${page}&limit=${limit}`, 'GET');
}

function deleteHistory(id) {
  return api.request(`/miniprogram/ai/history/${id}`, 'DELETE');
}

module.exports = {
  uploadAsset,
  loadCapabilities,
  loadSources,
  loadWorkflows,
  createTask,
  runTask,
  getTask,
  retryTask,
  loadHistory,
  deleteHistory,
};
