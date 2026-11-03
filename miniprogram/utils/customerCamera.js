const api = require('./api.js');
const token = () => (getApp().globalData || {}).token || wx.getStorageSync('token');

async function load(page) {
  const request = page._cameraRequest = (page._cameraRequest || 0) + 1;
  const leadId = String(page.data.leadId || ''), identity = token();
  page.setData({ cameraProjects: [], cameraLoading: true, cameraError: '' });
  try {
    if (!/^[1-9]\d*$/.test(leadId) || !identity) throw Error('identity unavailable');
    const result = await api.request('/miniprogram/construction/video/customer-projects/' + leadId, 'GET');
    if (page._cameraRequest !== request || page.data.leadId !== leadId || token() !== identity) return;
    const items = result.data && result.data.items;
    if (!Array.isArray(items) || items.some(item => !/^[1-9]\d*$/.test(String(item.id)) || typeof item.name !== 'string')) throw Error('invalid projects');
    page.setData({ cameraProjects: items });
  } catch {
    if (page._cameraRequest === request && token() === identity) page.setData({ cameraError: '工地视频暂时无法读取，请稍后重试。' });
  } finally { if (page._cameraRequest === request) page.setData({ cameraLoading: false }); }
}
function open(page, event) {
  const id = String(event.currentTarget.dataset.project || '');
  if (page.data.cameraProjects.some(item => String(item.id) === id))
    wx.navigateTo({ url: '/packages/construction/camera/camera?projectId=' + encodeURIComponent(id) });
}
function invalidate(page) { page._cameraRequest = (page._cameraRequest || 0) + 1; }
module.exports = { load, open, invalidate };
