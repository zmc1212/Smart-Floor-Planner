const api = require('./api');

const FILE_PREFIX = 'protected-img';
const memoryPaths = new Map();
const inFlight = new Map();

function sanitizeCacheKey(cacheKey) {
  return String(cacheKey || 'asset').replace(/[^a-zA-Z0-9_-]/g, '') || 'asset';
}

function stampKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
}

function floorPlanCacheKey(leadId, floorPlan) {
  const planId = floorPlan && (floorPlan.id || floorPlan._id);
  return sanitizeCacheKey([
    leadId,
    'fp',
    planId,
    stampKey((floorPlan && (floorPlan.updatedAt || floorPlan.completedAt)) || ''),
  ].filter(Boolean).join('-'));
}

function publishedImageCacheKey(leadId, generationId) {
  return sanitizeCacheKey(`${leadId}-${generationId || 'scheme'}`);
}

function candidatePaths(safeKey) {
  const root = wx.env && wx.env.USER_DATA_PATH;
  if (!root) return [];
  return ['png', 'jpg'].map((extension) => `${root}/${FILE_PREFIX}-${safeKey}.${extension}`);
}

function fileExistsSync(filePath) {
  try {
    wx.getFileSystemManager().accessSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function readCachedProtectedImage(cacheKey) {
  const safeKey = sanitizeCacheKey(cacheKey);
  const remembered = memoryPaths.get(safeKey);
  if (remembered && fileExistsSync(remembered)) return remembered;
  const found = candidatePaths(safeKey).find((filePath) => fileExistsSync(filePath)) || '';
  if (found) memoryPaths.set(safeKey, found);
  return found;
}

function getAuthToken() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && app.globalData.token) return app.globalData.token;
  } catch (error) {
    // getApp throws before launch in some Mini Program runtimes.
  }
  return (typeof wx !== 'undefined' && wx.getStorageSync && wx.getStorageSync('token')) || '';
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return '';
}

function downloadAndStore(endpoint, safeKey) {
  const baseUrl = api.getBaseUrls()[0];
  const token = getAuthToken();
  const fileRoot = wx.env && wx.env.USER_DATA_PATH;
  return new Promise((resolve, reject) => {
    if (!endpoint) {
      reject(new Error('缺少图片地址'));
      return;
    }
    if (!fileRoot) {
      reject(new Error('本地缓存目录不可用'));
      return;
    }
    wx.request({
      url: `${String(baseUrl).replace(/\/+$/, '')}${endpoint}`,
      method: 'GET',
      responseType: 'arraybuffer',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(response) {
        if (response.statusCode !== 200 || !response.data) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const contentType = response.header && (response.header['content-type'] || response.header['Content-Type']);
        const extension = extensionFromContentType(contentType);
        if (!extension) {
          reject(new Error('图片格式不受支持'));
          return;
        }
        const filePath = `${fileRoot}/${FILE_PREFIX}-${safeKey}.${extension}`;
        wx.getFileSystemManager().writeFile({
          filePath,
          data: response.data,
          success: () => {
            memoryPaths.set(safeKey, filePath);
            resolve(filePath);
          },
          fail: (error) => reject(error instanceof Error ? error : new Error((error && error.errMsg) || '图片临时文件写入失败')),
        });
      },
      fail: (error) => reject(error instanceof Error ? error : new Error((error && error.errMsg) || '图片读取失败')),
    });
  });
}

function fetchProtectedImage(endpoint, cacheKey) {
  const safeKey = sanitizeCacheKey(cacheKey);
  const cached = readCachedProtectedImage(safeKey);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(safeKey);
  if (pending) return pending;
  const task = downloadAndStore(endpoint, safeKey).finally(() => {
    if (inFlight.get(safeKey) === task) inFlight.delete(safeKey);
  });
  inFlight.set(safeKey, task);
  return task;
}

function resetProtectedImageCacheForTests() {
  memoryPaths.clear();
  inFlight.clear();
}

module.exports = {
  fetchProtectedImage,
  readCachedProtectedImage,
  floorPlanCacheKey,
  publishedImageCacheKey,
  resetProtectedImageCacheForTests,
};
