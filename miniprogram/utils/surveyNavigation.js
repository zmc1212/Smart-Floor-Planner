const FORMAL_DRAFT_KEY = 'surveying_draft_v1';
const FORMAL_SERVER_DRAFT_ID_KEY = 'surveying_floorplan_id';

async function ensureOnSiteVisit(leadId) {
  const id = String(leadId || '').trim();
  if (!id) return null;
  try {
    const api = require('./api.js');
    const result = await api.request('/appointments', 'POST', { leadId: id, source: 'on_site' });
    return result && result.data ? result.data : null;
  } catch (error) {
    return null;
  }
}

async function openSurveyingEditor(options) {
  const opts = options || {};
  const app = getApp();
  const signedContext = app && app.globalData && (app.globalData.bootstrap || app.globalData.userInfo);
  if (signedContext) {
    const navigation = require('./identity-navigation.js');
    if (!navigation.canAccessRoute('/packages/surveying/editor/surveying-editor', signedContext)) {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: '当前身份不能进入量房编辑器', icon: 'none' });
      }
      return false;
    }
  }
  if (opts.leadId) {
    await ensureOnSiteVisit(opts.leadId);
  }
  const startNewSurvey = !!opts.startNewSurvey;
  const newSurveyKey = startNewSurvey
    ? (opts.newSurveyKey || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    : '';
  app.globalData.surveyingEditorContext = {
    leadId: opts.leadId || '',
    leadName: opts.leadName || '',
    communityName: opts.communityName || '',
    floorPlanId: opts.floorPlanId || '',
    startNewSurvey,
    newSurveyKey
  };
  const query = [];
  if (opts.leadId) query.push(`leadId=${encodeURIComponent(opts.leadId)}`);
  if (opts.floorPlanId) query.push(`floorPlanId=${encodeURIComponent(opts.floorPlanId)}`);
  if (startNewSurvey) {
    query.push('newSurvey=1');
    query.push(`newSurveyKey=${encodeURIComponent(newSurveyKey)}`);
  }
  wx.navigateTo({
    url: `/packages/surveying/editor/surveying-editor${query.length ? `?${query.join('&')}` : ''}`
  });
  return true;
}

function clearSurveyingEditorDraft(leadId, floorPlanId) {
  const suffix = leadId || 'standalone';
  const serverDraftKey = `${FORMAL_SERVER_DRAFT_ID_KEY}_${suffix}`;

  try {
    const storedFloorPlanId = wx.getStorageSync(serverDraftKey);
    if (floorPlanId && String(storedFloorPlanId || '') !== String(floorPlanId)) return;

    wx.removeStorageSync(serverDraftKey);
    wx.removeStorageSync(`${FORMAL_DRAFT_KEY}_${suffix}`);
  } catch (err) {
    // Local cleanup should not block deletion of the cloud floor plan.
  }
}

module.exports = { openSurveyingEditor, clearSurveyingEditorDraft };
