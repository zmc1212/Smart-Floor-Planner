const api = require('../../../utils/api.js');
const PREFIX = '/miniprogram/assistant';
const JOURNAL = 'assistant-pending-v1';
function currentSession() {
  try { return (typeof getApp === 'function' && getApp().globalData.token) || wx.getStorageSync('token') || ''; } catch (_) { return ''; }
}
class PendingOperations extends Map {
  constructor() {
    super(); this.session = currentSession();
    try {
      const saved = wx.getStorageSync(JOURNAL);
      if (this.session && saved?.session === this.session && Array.isArray(saved.entries)) {
        for (const [slot, value] of saved.entries) super.set(slot, value);
      }
    } catch (_) { /* Non-WeChat tests and storage failures retain in-memory retry. */ }
  }
  persist(slot, value, clear = false) {
    try {
      if (!this.session || this.session !== currentSession()) return;
      const saved = wx.getStorageSync(JOURNAL);
      const entries = new Map(!clear && saved?.session === this.session ? saved.entries : []);
      if (slot) { if (value) entries.set(slot, value); else entries.delete(slot); }
      wx.setStorageSync(JOURNAL, { session: this.session, entries: [...entries] });
    } catch (_) { /* The original key stays in memory if device storage is full. */ }
  }
  set(slot, value) { super.set(slot, value); this.persist(slot, value); return this; }
  delete(slot) { const result = super.delete(slot); this.persist(slot, null); return result; }
  clear() { super.clear(); this.session = currentSession(); this.persist(null, null, true); }
}

function operationKey() {
  return `mini.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.${Math.random().toString(36).slice(2)}`;
}

function uncertain(error) {
  return !error.statusCode || error.statusCode >= 500 || error.statusCode === 408;
}

function validOwnerReceipt(slot, pending, data) {
  const match = /^\/conversations\/([1-9]\d*)\/public-sites\/([1-9]\d*)\/(preview|approve|decline|withdraw)$/.exec(pending.path);
  if (!match || slot !== `public-owner:${match[1]}:${match[2]}`) return false;
  const status = { preview: 'pending_owner', approve: 'owner_approved', decline: 'declined', withdraw: 'withdrawn' }[match[3]];
  if (data.id !== match[2] || data.versionId !== pending.body.versionId || data.status !== status
    || !Number.isSafeInteger(pending.body.expectedRevision) || pending.body.expectedRevision < 0
    || !Number.isSafeInteger(data.revision) || data.revision !== pending.body.expectedRevision + 1) return false;
  if (match[3] !== 'preview') return true;
  const material = data.material;
  return !!material && material.id === data.id && material.versionId === data.versionId
    && material.revision === data.revision && material.status === status
    && Array.isArray(material.photos) && Array.isArray(material.excerpts);
}

function validPlanReceipt(slot, pending, data) {
  const m = /^\/conversations\/([1-9]\d*)\/plans\/([1-9]\d*)\/(preview|approve|decline|request-changes|defer)$/.exec(pending.path);
  if (!m || slot !== `plan-decision:${m[1]}:${m[2]}` || data.id !== m[2] || !Number.isSafeInteger(data.revision) || data.revision !== pending.body.expectedRevision + 1) return false;
  if (m[3] === 'preview') return ['pending_customer','deferred'].includes(data.status) && data.material?.id === data.id
    && data.material.revision === data.revision && data.material.status === data.status && typeof data.material.difference === 'string'
    && typeof data.material.title === 'string' && Number.isSafeInteger(data.material.number) && data.material.number > 0 && /^[1-9]\d*$/.test(String(data.material.issueId))
    && /^[1-9]\d*$/.test(String(data.material.mediaId)) && Number.isSafeInteger(data.material.costDeltaCents) && Number.isSafeInteger(data.material.scheduleDeltaDays);
  return data.status === { approve: 'approved', decline: 'declined', 'request-changes': 'changes_requested', defer: 'deferred' }[m[3]];
}

const COPY = {
  portfolio_not_found: '作品或设计师当前不可用，可以返回原咨询看看其他方向。',
  portfolio_forbidden: '当前身份无法查看这份作品，请切换到业主身份。',
  portfolio_owner_conflict: '你已有服务负责人，当前服务人保持不变。可以回原咨询，请设计师协调本次意向。',
  invalid_portfolio: '作品信息已变化，请刷新后再操作。',
  need_memory_limit: '这段咨询记录较多，可以回原咨询开启新对话后继续。',
  reference_unavailable: '这份参考案例已不可用，可以继续聊你的想法或换个方向。',
  reference_preference_not_explicit: '请说清喜欢或不合适的是第几个参考案例。',
  media_invalid: '请选择4MB以内的有效JPEG或PNG图片，房间名称不超过80字。',
  media_limit: '本次会话最多上传20张图片，请在新对话中继续补充。',
  assistant_disabled: '当前企业暂未开放小K咨询，已有对话仍可查看。',
  assistant_capability_forbidden: '请切换到业主身份后使用小K咨询。',
  assistant_resource_not_found: '这段对话已不可访问，请返回历史记录重新选择。',
  entry_context_invalid: '暂时无法确认服务企业，请从有效的装修服务入口进入。',
  identity_context_invalid: '登录状态已失效，请重新登录后继续。',
  assistant_quota_exceeded: '今天的咨询额度已用完，请稍后再来。',
  conversation_busy: '这段对话还有回答正在处理，请先查看处理结果。',
  conversation_read_only: '这段对话已结束，可以查看记录或开启新对话。',
  context_changed: '对话状态已更新，请刷新后继续。',
  version_conflict: '对话状态已更新，请刷新后再操作。',
  idempotency_conflict: '这次操作的内容已改变，请刷新对话后继续。',
  invalid_message: '请检查文字内容和长度后再发送。',
  construction_material_scope_required: '请说明一个已开放工地的具体房间；重名时使用“项目名·房间名”。',
  construction_material_image_required: '请先发一张点位图，再紧接着说明共享到哪个房间；需求节选请用文字。',
  plan_unavailable: '此方案已撤回、替换或依据已变化，请刷新查看当前版本。',
  plan_state_conflict: '这份方案已有决定，请刷新查看结果。',
  plan_preview_required: '请先查看这一版的完整图纸、差异和影响。',
  invalid_plan: '请核对方案版本和修改说明后重试。',
  model_unavailable: '小K暂时无法回答，请稍后再试。',
  retrieval_unavailable: '暂时无法读取装修资料，请稍后重试。',
  knowledge_not_ready: '企业装修资料还在准备中，请稍后再来。',
  assistant_unavailable: '服务暂时不可用，请稍后重新连接。',
  requirements_empty: '先在对话中说说你的装修想法，再来整理需求摘要。',
  requirements_stale: '对话里有新的补充，请根据最新对话重新整理后再确认。',
  requirements_history_too_long: '这段对话较长，请开启新对话并集中补充装修需求后再整理。',
};

function errorCopy(error) {
  if (error && error.statusCode === 401) return COPY.identity_context_invalid;
  return COPY[error && (error.code || error.error)] || '网络连接暂时中断，请重新连接。';
}

class AssistantClient {
  constructor(request = api.request) {
    this.request = request;
    this.pending = new PendingOperations();
  }

  async read(path, data = {}, headers = {}, method = 'GET') {
    const result = await this.request(`${PREFIX}${path}`, method, data, {
      headers, suppressUnauthorized: true,
    });
    if (!result || !result.success || !result.data || typeof result.data !== 'object') {
      throw { code: 'invalid_response' };
    }
    return result.data;
  }

  // Unknown network outcomes retain the original key AND body. A retry can
  // recover the committed result without producing another message or charge.
  async mutate(slot, path, body = {}, method = 'POST') {
    let pending = this.pending.get(slot);
    if (!pending) {
      const key = operationKey();
      pending = { key, body: JSON.parse(JSON.stringify(body)), path, method };
      if (slot.startsWith('send:')) pending.body.clientMessageId = key;
      this.pending.set(slot, pending);
    }
    try {
      const data = await this.read(pending.path, pending.body, { 'Idempotency-Key': pending.key }, pending.method);
      if (slot.startsWith('send:') || slot.startsWith('retry:')) {
        if ((!data.runId && !(slot.startsWith('send:') && data.status === 'succeeded' && data.messageId)) || !data.conversationId) throw { code: 'invalid_response' };
      } else if ((slot === 'create' || slot.startsWith('portfolio-create:')) && !data.id) throw { code: 'invalid_response' };
      else if (slot.startsWith('requirements:') && (!data.id || !data.version || !['draft', 'confirmed', 'redacted'].includes(data.status))) throw { code: 'invalid_response' };
      else if ((slot.startsWith('media:') || slot.startsWith('media-formal:')) && (!data.id || !data.conversationId)) throw { code: 'invalid_response' };
      else if (slot.startsWith('portfolio-write:') && pending.path.endsWith('/preference')
        && (data.sentiment !== pending.body.sentiment || !Number.isInteger(data.preferenceVersion) || data.preferenceVersion < 1)) throw { code: 'invalid_response' };
      else if (slot.startsWith('portfolio-write:') && pending.path.endsWith('/contact')
        && (!data.conversationId || !data.handoff)) throw { code: 'invalid_response' };
      else if (slot.startsWith('public-owner:') && !validOwnerReceipt(slot, pending, data)) throw { code: 'invalid_response' };
      else if (slot.startsWith('plan-decision:') && !validPlanReceipt(slot, pending, data)) throw { code: 'invalid_response' };
      else if (slot.startsWith('public-context:') && !data.conversationId) throw { code: 'invalid_response' };
      this.pending.delete(slot);
      return data;
    } catch (error) {
      if (!uncertain(error)) this.pending.delete(slot);
      throw error;
    }
  }
}

function entryInput(options = {}) {
  const keys = ['conversationId', 'leadId', 'entryCode','referenceEntry', 'portfolioEntry', ...(!options.conversationId ? ['publicEnterpriseId'] : [])].filter(key => options[key]);
  if (keys.length > 1) throw { code: 'entry_context_invalid', statusCode: 422 };
  return keys.length ? { [keys[0]]: String(options[keys[0]]) } : {};
}

function messagesForView(items) {
  const latestPlan = new Map();
  for (const m of items || []) if (m.planDecision && m.available !== false) {
    const previous = latestPlan.get(m.planDecision.id), seq = String(m.seq || '0'), before = String(previous?.seq || '0');
    if (!previous || seq.length > before.length || seq.length === before.length && seq >= before) latestPlan.set(m.planDecision.id, m);
  }
  const latestPublic = new Map();
  for (const message of items || []) if (message.publicConsent) {
    const k = message.publicConsent.id + '_' + message.publicConsent.versionId, previous = latestPublic.get(k);
    const seq = String(message.seq || '0'), before = String(previous?.seq || '0');
    if (!previous || seq.length > before.length || seq.length === before.length && seq >= before) latestPublic.set(k, message);
  }
  const record = r => r?.available && /^[1-9]\d*$/.test(String(r.id)) && Number.isSafeInteger(r.version)
    ? { ...r, assets: (r.assets || []).filter(id => /^[1-9]\d*$/.test(String(id))).slice(0, 4).map(String) } : null;
  return (items || []).map(item => ({
    ...item,
    isUser: item.authorKind === 'user',
    planDecision: item.available !== false && item.planDecision && latestPlan.get(item.planDecision.id) === item ? item.planDecision : null,
    publicConsent: item.available !== false && item.publicConsent && latestPublic.get(item.publicConsent.id + '_' + item.publicConsent.versionId) === item && /^[1-9]\d*$/.test(String(item.publicConsent.id)) && /^[1-9]\d*$/.test(String(item.publicConsent.versionId)) && Array.isArray(item.publicConsent.photos) && Array.isArray(item.publicConsent.excerpts) ? item.publicConsent : null,
    publicContext: item.available !== false && item.publicContext && /^[1-9]\d*$/.test(String(item.publicContext.id)) && /^[1-9]\d*$/.test(String(item.publicContext.versionId)) ? item.publicContext : null,
    publicReferences: item.available !== false ? (item.publicReferences || []).filter(r => /^[1-9]\d*$/.test(String(r.id)) && /^[1-9]\d*$/.test(String(r.versionId))).slice(0, 8) : [],
    siteRecord: item.available !== false && item.siteRecord?.available && /^[1-9]\d*$/.test(String(item.siteRecord.id)) && Number.isSafeInteger(item.siteRecord.version)
      ? { ...item.siteRecord, assets: (item.siteRecord.assets || []).filter(id => /^[1-9]\d*$/.test(String(id))).slice(0, 4).map(String) } : null,
    siteRecordList: item.available !== false ? [item.siteRecord, ...(item.siteRecords || [])].map(record).filter(Boolean).filter((r, index, all) => all.findIndex(a => a.id === r.id && a.version === r.version) === index) : [],
    siteWatch: item.available !== false && item.siteWatch && /^[1-9]\d*$/.test(String(item.siteWatch.id)) && typeof item.siteWatch.cancelText === 'string' && item.siteWatch.cancelText.length <= 300 ? item.siteWatch : null,
    constructionContacts: item.available === false ? [] : (Array.isArray(item.constructionContacts) ? item.constructionContacts : []).filter(c =>
      /^\d+$/.test(String(c.projectId)) && typeof c.stageKey === 'string'
    ).map(c => ({ projectId: String(c.projectId), stageKey: c.stageKey, projectName: String(c.projectName || '') })),
    suggestDesigner: item.authorKind === 'assistant' && (item.content?.blocks || []).some(b => b.text === '这部分需要设计师结合本次情况继续沟通。你愿意的话，可以请设计师接着聊。'),
    // A known citation already has a tappable source chip below the bubble.
    // Keep fallback text for unmatched/future blocks instead of hiding content.
    blocks: (item.content && item.content.blocks || []).filter(block =>
      block.type !== 'citation' || !(item.citations || []).some(citation => String(citation.id) === String(block.citationId))
    ).map((block, index) => ({
      key: index,
      // Never interpret model HTML, URLs or action instructions.
      text: block.type === 'text' ? String(block.text || '') : String(block.fallbackText || '这段内容暂时无法展示。'),
    })),
    citations: (item.citations || []).map(citation => ({
      id: citation.id, available: citation.available,
      title: citation.available ? citation.title : '资料已不可用',
    })),
  })).sort((a, b) => String(a.seq).length - String(b.seq).length || String(a.seq).localeCompare(String(b.seq)));
}

module.exports = { AssistantClient, entryInput, errorCopy, uncertain, messagesForView };
