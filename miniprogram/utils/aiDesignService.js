const api = require('./api.js');

function getToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function buildQueryString(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function uploadToEndpoint(baseUrl, endpoint, filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}${endpoint}`,
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

async function uploadWithFallback(endpoint, filePath) {
  const baseUrls = api.getBaseUrls();
  let lastError = null;
  for (let index = 0; index < baseUrls.length; index += 1) {
    try {
      return await uploadToEndpoint(baseUrls[index], endpoint, filePath);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('图片上传失败');
}

async function uploadAsset(filePath) {
  return uploadWithFallback('/miniprogram/ai/assets', filePath);
}

function loadCapabilities() {
  return api.request('/miniprogram/ai/capabilities', 'GET').then((res) => res.data);
}

function loadRecipes(params = {}) {
  const query = buildQueryString(params);
  return api.request(`/miniprogram/ai/recipes${query ? `?${query}` : ''}`, 'GET').then((res) => res.data);
}

function getRecipe(id) {
  return api.request(`/miniprogram/ai/recipes/${encodeURIComponent(id)}`, 'GET').then((res) => res.data);
}

function groupFlatSources(items) {
  const plans = [];
  const byId = {};
  (items || []).forEach((item) => {
    let plan = byId[item.floorPlanId];
    if (!plan) {
      plan = {
        leadId: item.leadId || '',
        leadName: item.leadName || '未关联客户',
        communityName: item.communityName || '',
        floorPlanId: item.floorPlanId,
        floorPlanName: item.floorPlanName || '正式户型',
        projectTitle: item.projectTitle || item.communityName || item.leadName || item.floorPlanName || '正式户型',
        projectSubtitle: item.projectSubtitle || item.leadName || '量房记录',
        floorPlanStatus: item.floorPlanStatus,
        updatedAt: item.updatedAt,
        rooms: [],
      };
      byId[item.floorPlanId] = plan;
      plans.push(plan);
    }
    plan.rooms.push({
      roomId: item.roomId,
      roomName: item.roomName,
      roomSize: item.roomSize,
      openingCount: item.openingCount,
    });
    plan.closedRoomCount = plan.rooms.length;
  });
  return plans;
}

function loadSources() {
  return api.request('/miniprogram/ai/sources', 'GET').then((res) => (
    Array.isArray(res.plans) ? res.plans : groupFlatSources(res.data || [])
  ));
}

function loadWorkflows(params = {}) {
  const query = buildQueryString(params);
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

// The API keeps the authenticated operator boundary and exact floor-plan filter
// on the server, so a busy surveyor's older customer render cannot be missed.
function loadHeroFloorPlanResults(floorPlanId) {
  if (!floorPlanId) return Promise.resolve([]);
  return api.request(
    `/miniprogram/ai/history?heroFloorPlanId=${encodeURIComponent(floorPlanId)}`,
    'GET'
  ).then((res) => res.data || []);
}

function deleteHistory(id) {
  return api.request(`/miniprogram/ai/history/${id}`, 'DELETE');
}

// Legacy single-image publication API. Prefer scheme merge publish inside scheme-studio.
function getPublication(leadId, generationId) {
  return api.request(
    `/leads/${encodeURIComponent(leadId)}/ai-publications?generationId=${encodeURIComponent(generationId)}`,
    'GET',
  ).then((res) => res.data);
}

function publishGeneration(leadId, generationId) {
  return api.request(`/leads/${encodeURIComponent(leadId)}/ai-publications`, 'POST', { generationId }).then((res) => res.data);
}

function withdrawGeneration(leadId, generationId) {
  return api.request(
    `/leads/${encodeURIComponent(leadId)}/ai-publications/${encodeURIComponent(generationId)}`,
    'DELETE',
  ).then((res) => res.data);
}

function listSchemePublications(leadId) {
  return api.request(`/leads/${encodeURIComponent(leadId)}/ai-scheme-publications`, 'GET').then((res) => res.data || []);
}

function publishScheme(leadId, payload) {
  return api.request(`/leads/${encodeURIComponent(leadId)}/ai-scheme-publications`, 'POST', payload).then((res) => res.data);
}

function withdrawScheme(leadId, workflowId) {
  return api.request(
    `/leads/${encodeURIComponent(leadId)}/ai-scheme-publications/${encodeURIComponent(workflowId)}`,
    'DELETE',
  ).then((res) => res.data);
}

function finalizeScheme(leadId, workflowId) {
  return api.request(
    `/leads/${encodeURIComponent(leadId)}/ai-scheme-publications/${encodeURIComponent(workflowId)}/finalize`,
    'POST',
  ).then((res) => res.data);
}

function withdrawSchemeGeneration(leadId, workflowId, generationId) {
  return api.request(
    `/leads/${encodeURIComponent(leadId)}/ai-scheme-publications/${encodeURIComponent(workflowId)}/generations/${encodeURIComponent(generationId)}`,
    'DELETE',
  ).then((res) => res.data);
}

function loadStudioBootstrap() {
  return api.request('/miniprogram/ai/studio/bootstrap', 'GET').then((res) => res.data);
}

function loadStudioLeads(params = {}) {
  const query = buildQueryString(params);
  return api.request(`/miniprogram/ai/studio/leads${query ? `?${query}` : ''}`, 'GET').then((res) => ({
    items: Array.isArray(res.data) ? res.data : [],
    pagination: (res && res.pagination) || {},
  }));
}

function listStudioWorkflows(params = {}, options = {}) {
  const query = buildQueryString(params);
  return api.request(`/miniprogram/ai/studio/workflows${query ? `?${query}` : ''}`, 'GET', {}, options)
    .then((res) => res.data || []);
}

function getStudioWorkflow(workflowId, options = {}) {
  return api.request(`/miniprogram/ai/studio/workflows/${encodeURIComponent(workflowId)}`, 'GET', {}, options)
    .then((res) => res.data);
}

function createStudioWorkflow(payload) {
  return api.request('/miniprogram/ai/studio/workflows', 'POST', payload).then((res) => res.data);
}

function renameStudioWorkflow(workflowId, title) {
  return api.request(`/miniprogram/ai/studio/workflows/${encodeURIComponent(workflowId)}`, 'PATCH', {
    action: 'rename',
    title,
  }).then((res) => res.data);
}

function deleteStudioWorkflow(workflowId) {
  return api.request(`/miniprogram/ai/studio/workflows/${encodeURIComponent(workflowId)}`, 'DELETE').then((res) => res.data);
}

function deleteStudioGeneration(workflowId, generationId) {
  return api.request(
    `/miniprogram/ai/studio/workflows/${encodeURIComponent(workflowId)}/generations/${encodeURIComponent(generationId)}`,
    'DELETE',
  ).then((res) => res.data);
}

function getStudioTask(workflowId, options = {}) {
  return api.request(`/miniprogram/ai/studio/tasks?workflowId=${encodeURIComponent(workflowId)}`, 'GET', {}, options)
    .then((res) => res.data);
}

function createStudioTask(payload) {
  return api.request('/miniprogram/ai/studio/tasks', 'POST', payload).then((res) => res.data);
}

function submitStudioBatch(taskId, payload) {
  return api.request(
    `/miniprogram/ai/studio/tasks/${encodeURIComponent(taskId)}/batches`,
    'POST',
    payload,
    { timeout: 120000 },
  ).then((res) => res.data);
}

function retryStudioBatch(taskId, batchId) {
  return api.request(
    `/miniprogram/ai/studio/tasks/${encodeURIComponent(taskId)}/batches/${encodeURIComponent(batchId)}/retry`,
    'POST',
    {},
    { timeout: 120000 },
  ).then((res) => res.data);
}

function uploadStudioAsset(filePath) {
  return uploadWithFallback('/miniprogram/ai/studio/assets', filePath);
}

function loadStudioPromptCategories() {
  return api.request('/miniprogram/ai/studio/prompt-categories', 'GET').then((res) => res.data || []);
}

function loadStudioPromptTemplates(params = {}) {
  const query = buildQueryString(params);
  return api.request(`/miniprogram/ai/studio/prompt-templates${query ? `?${query}` : ''}`, 'GET').then((res) => res.data);
}

function assistStudioPrompt(payload) {
  // Reasoning models may need longer than the generic 30s API timeout.
  return api.request('/miniprogram/ai/studio/prompt-assist', 'POST', payload, { timeout: 120000 }).then((res) => res.data);
}

module.exports = {
  uploadAsset,
  loadCapabilities,
  loadRecipes,
  getRecipe,
  loadSources,
  loadWorkflows,
  createTask,
  runTask,
  getTask,
  retryTask,
  loadHistory,
  loadHeroFloorPlanResults,
  deleteHistory,
  getPublication,
  publishGeneration,
  withdrawGeneration,
  listSchemePublications,
  publishScheme,
  withdrawScheme,
  finalizeScheme,
  withdrawSchemeGeneration,
  loadStudioBootstrap,
  loadStudioLeads,
  listStudioWorkflows,
  getStudioWorkflow,
  createStudioWorkflow,
  renameStudioWorkflow,
  deleteStudioWorkflow,
  deleteStudioGeneration,
  getStudioTask,
  createStudioTask,
  submitStudioBatch,
  retryStudioBatch,
  uploadStudioAsset,
  loadStudioPromptCategories,
  loadStudioPromptTemplates,
  assistStudioPrompt,
  groupFlatSources,
};
