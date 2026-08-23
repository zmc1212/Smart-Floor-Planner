const api = require('./api.js');

const SPACE_TAGS = Object.freeze([
  { key: 'living_room', label: '客厅', quick: true },
  { key: 'master_bedroom', label: '主卧', quick: true },
  { key: 'secondary_bedroom', label: '次卧', quick: true },
  { key: 'master_bathroom', label: '主卫', quick: true },
  { key: 'secondary_bathroom', label: '次卫', quick: true },
  { key: 'kitchen', label: '厨房', quick: false },
  { key: 'dining_room', label: '餐厅', quick: false },
  { key: 'balcony', label: '阳台', quick: false },
  { key: 'study', label: '书房', quick: false },
  { key: 'other', label: '其他', quick: false },
]);

function getToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function sitePhotosPath(leadId) {
  return `/miniprogram/leads/${encodeURIComponent(leadId)}/site-photos`;
}

function decoratePhoto(photo) {
  const previewUrl = String((photo && photo.previewUrl) || '');
  const https = /^https?:\/\//i.test(previewUrl);
  return {
    ...photo,
    spaceTagLabel: photo && photo.spaceTagLabel || labelForTag(photo && photo.spaceTag),
    imagePath: https ? previewUrl : (photo && photo.imagePath) || '',
    imageState: https || (photo && photo.imagePath) ? 'loaded' : (previewUrl ? 'loading' : 'empty'),
  };
}

function labelForTag(key) {
  const match = SPACE_TAGS.find((item) => item.key === key);
  return match ? match.label : '';
}

function list(leadId) {
  if (!leadId) return Promise.resolve({ items: [], spaceTags: SPACE_TAGS, limit: 30, remaining: 30 });
  return api.request(sitePhotosPath(leadId), 'GET').then((res) => {
    const data = res.data || {};
    const spaceTags = Array.isArray(data.spaceTags) && data.spaceTags.length ? data.spaceTags : SPACE_TAGS;
    return {
      limit: Number(data.limit || 30),
      remaining: Number(data.remaining || 0),
      spaceTags,
      items: (data.items || []).map(decoratePhoto),
    };
  });
}

function upload(leadId, filePath, { source = 'album', spaceTag } = {}) {
  if (!leadId) return Promise.reject({ error: '缺少客户线索' });
  if (!spaceTag) return Promise.reject({ error: '请选择房间标签' });
  const token = getToken();
  const baseUrl = api.getBaseUrls()[0];
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}${sitePhotosPath(leadId)}`,
      filePath,
      name: 'file',
      formData: { source, spaceTag },
      timeout: 30000,
      header: { Authorization: token ? `Bearer ${token}` : '' },
      success(res) {
        let payload = null;
        try {
          payload = JSON.parse(res.data || '{}');
        } catch (error) {
          reject({ error: '现场图上传响应无法解析' });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && payload && payload.success) {
          resolve(decoratePhoto(payload.data));
          return;
        }
        reject(payload || { error: '现场图上传失败' });
      },
      fail: reject,
    });
  });
}

function updateTag(leadId, photoId, spaceTag) {
  return api.request(
    `${sitePhotosPath(leadId)}/${encodeURIComponent(photoId)}`,
    'PATCH',
    { spaceTag },
  ).then((res) => decoratePhoto(res.data));
}

function remove(leadId, photoId) {
  return api.request(
    `${sitePhotosPath(leadId)}/${encodeURIComponent(photoId)}`,
    'DELETE',
  ).then((res) => res.data);
}

function chooseMedia(source) {
  const sourceType = source === 'camera' ? ['camera'] : source === 'album' ? ['album'] : ['album', 'camera'];
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType,
      sizeType: ['compressed'],
      success(result) {
        const filePath = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath;
        if (!filePath) {
          reject({ error: '未选到照片' });
          return;
        }
        resolve({ filePath, source: source || (sourceType[0] === 'camera' ? 'camera' : 'album') });
      },
      fail(error) {
        const message = String((error && error.errMsg) || '');
        if (message.includes('cancel')) {
          reject({ cancelled: true });
          return;
        }
        reject({ error: '无法打开相机或相册' });
      },
    });
  });
}

function chooseCaptureSource() {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: ['拍照', '从微信相册选择'],
      success(res) {
        resolve(res.tapIndex === 0 ? 'camera' : 'album');
      },
      fail() {
        reject({ cancelled: true });
      },
    });
  });
}

function chooseAiSource() {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: ['拍照', '从微信相册选择', '从本户现场图选择'],
      success(res) {
        if (res.tapIndex === 2) {
          resolve({ kind: 'gallery' });
          return;
        }
        resolve({ kind: 'capture', source: res.tapIndex === 0 ? 'camera' : 'album' });
      },
      fail() {
        reject({ cancelled: true });
      },
    });
  });
}

async function captureAndUpload(leadId, { source, spaceTag } = {}) {
  const chosenSource = source || await chooseCaptureSource();
  const picked = await chooseMedia(chosenSource);
  return upload(leadId, picked.filePath, { source: picked.source || chosenSource, spaceTag });
}

function previewUrls(photos, current) {
  const urls = (photos || [])
    .map((item) => item.imagePath || item.previewUrl)
    .filter((url) => typeof url === 'string' && url);
  const currentUrl = current && (current.imagePath || current.previewUrl);
  return { urls, current: currentUrl || urls[0] || '' };
}

function mergePhotos(photos, detail) {
  const list = Array.isArray(photos) ? photos.slice() : [];
  if (detail && detail.removedId) {
    return list.filter((item) => String(item.id) !== String(detail.removedId));
  }
  const photo = detail && detail.photo;
  if (!photo || !photo.id) return list;
  const next = list.filter((item) => String(item.id) !== String(photo.id));
  next.unshift(decoratePhoto(photo));
  return next;
}

module.exports = {
  SPACE_TAGS,
  decoratePhoto,
  labelForTag,
  list,
  upload,
  updateTag,
  remove,
  chooseMedia,
  chooseCaptureSource,
  chooseAiSource,
  captureAndUpload,
  previewUrls,
  mergePhotos,
};
