import { fail } from '../contracts';
import { referenceOnlyClause } from '../knowledge/reference-intent';
import { excerptRequirements, requirementKeys, allRequirementKeys, type ConfirmedRequirements, type RequirementKey } from './contract';

export type GuidanceQuestion = { field: RequirementKey; text: string; key?: string; options?: string[]; answerType?: 'text' | 'single' | 'multiple'; skippable?: boolean };
export type Guidance = { schemaVersion?: 2 | 3; enabled: boolean; opening: string; completion: string; questions: GuidanceQuestion[]; chatFirst?: boolean };
export type GuidanceCheckpoint = { after: number; fields: ConfirmedRequirements };
import { defaultGuidance, questionDefinitions, roomQuestionDefinitions } from './guidance-defaults';
export { defaultGuidance, legacyDefaultGuidance, questionDefinitions } from './guidance-defaults';
export function validateGuidance(value: unknown): Guidance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_message', 422);
  const v = value as Guidance;
  if (Object.keys(v).some(k => !['schemaVersion', 'enabled', 'opening', 'completion', 'questions'].includes(k)) || typeof v.enabled !== 'boolean' || (v.schemaVersion !== undefined && v.schemaVersion !== 2 && v.schemaVersion !== 3)) fail('invalid_message', 422);
  const text = (s: unknown, max: number) => {
    if (typeof s !== 'string' || !s.trim() || Array.from(s).length > max) fail('invalid_message', 422);
    return s.trim();
  };
  if (v.schemaVersion === 2 || v.schemaVersion === 3) {
    const definitions = v.schemaVersion === 3 ? [...questionDefinitions, ...roomQuestionDefinitions] : questionDefinitions;
    if (!Array.isArray(v.questions) || v.questions.length !== definitions.length || new Set(v.questions.map(q => q?.key)).size !== definitions.length) fail('invalid_message', 422);
    return { schemaVersion: v.schemaVersion, enabled: v.enabled, opening: text(v.opening, 600), completion: text(v.completion, 600), questions: v.questions.map(q => {
      const definition = definitions.find(d => d.key === q?.key);
      const keys = v.schemaVersion === 3 ? ['key', 'field', 'text', 'options', 'answerType', 'skippable'] : ['key', 'field', 'text', 'options'];
      if (!definition || q.field !== definition.field || Object.keys(q).some(k => !keys.includes(k)) || !Array.isArray(q.options) || q.options.length > 6) fail('invalid_message', 422);
      if (v.schemaVersion === 3 && (!['text', 'single', 'multiple'].includes(q.answerType!) || typeof q.skippable !== 'boolean')) fail('invalid_message', 422);
      const options = q.options.map(s => text(s, 30));
      if (new Set(options).size !== options.length) fail('invalid_message', 422);
      return { key: definition.key, field: definition.field, text: text(q.text, 500), options, ...(v.schemaVersion === 3 ? { answerType: q.answerType, skippable: q.skippable } : {}) };
    }) };
  }
  if (!Array.isArray(v.questions) || v.questions.length !== 5 || new Set(v.questions.map(q => q?.field)).size !== 5) fail('invalid_message', 422);
  return { enabled: v.enabled, opening: text(v.opening, 600), completion: text(v.completion, 600), questions: v.questions.map(q => {
    if (!q || Object.keys(q).some(k => !['field', 'text'].includes(k)) || !requirementKeys.some(k => k === q.field)) fail('invalid_message', 422);
    return { field: q.field, text: text(q.text, 500) };
  }) };
}
export function configuredGuidance(value: unknown) { return value ? validateGuidance(value) : defaultGuidance; }
export function guidanceOpening(g: Guidance) { return g.enabled ? '先聊聊你家的情况吧，新房还是旧房？' : null; }
export function conversationGuidance(entry: unknown): Guidance | null {
  const g = (entry as { guidance?: Guidance } | null)?.guidance;
  return g?.enabled ? { ...validateGuidance(g), chatFirst: true } : null;
}
const isQuestion = (s: string) => /[?？]/.test(s) || (!/^(还没|暂未|不确定|还不|不知道)/.test(s)
  && (/怎么|如何|为什么|能不能|可不可以|多少钱|什么|哪些|是否/.test(s)
    || /^(请问|介绍|讲讲|说说|解释|告诉我|帮我)|吗[。！!\s]*$/.test(s)));
const isGreeting = (s: string) => /^(你好|您好|嗨|哈喽|好的?|嗯|谢谢|开始|继续)[。！!\s]*$/.test(s);
/** Ordered, traceable interview replay. Short answers use the active question,
 * never a model-inferred household count, amount, or date. */
export function guidanceProgress(g: Guidance, messages: Array<{ id: string; text: string }>, checkpoint?: GuidanceCheckpoint) {
  if (g.chatFirst) return chatFirstProgress(g, messages);
  if (g.schemaVersion === 2 || g.schemaVersion === 3) return detailedProgress(g, messages, checkpoint);
  const fields = excerptRequirements([]);
  let paused = false, interrupt = false, lastControl = false;
  for (const message of messages) {
    const text = message.text.trim();
    interrupt = isQuestion(text); lastControl = false;
    if (/^(先暂停|暂停整理|不想填|先不聊|停止整理)[。！!\s]*$/.test(text)) { paused = true; lastControl = true; continue; }
    if (/^(继续整理|开始整理|继续了解)[。！!\s]*$/.test(text)) { paused = false; lastControl = true; continue; }
    if (interrupt || isGreeting(text)) continue;
    const pending = g.questions.find(q => !fields[q.field].text);
    const excerpts = excerptRequirements([message]);
    const mentioned = requirementKeys.filter(k => excerpts[k].text);
    for (const k of mentioned) fields[k] = excerpts[k];
    if (!paused && pending && !mentioned.length) {
      const chars = Array.from(text);
      fields[pending.field] = { text: chars.slice(0, 1000).join(''), sourceMessageId: message.id, truncated: chars.length > 1000 };
    }
  }
  const next = g.questions.find(q => !fields[q.field].text);
  const reply = paused ? '好的，先暂停整理。你可以直接提问，需要时说“继续整理”。'
    : next ? next.text : g.completion;
  return { fields, next, paused, interrupt, lastControl, reply };
}

/** Five optional topics, replayed from durable customer messages. A topic change
 * suspends prompting until the customer explicitly asks to resume. Statements
 * remain verbatim evidence; they are never promoted to customer approval. */
export function chatFirstProgress(g: Guidance, messages: Array<{ id: string; text: string }>) {
  const fields = excerptRequirements([]);
  const rooms = new Map<string, { text: string; sourceMessageId: string }>();
  const facts: Record<string, RegExp> = {
    housing: /新房|旧房|二手房|毛坯|精装房|户型|面积|\d+\s*(?:平|㎡|室|厅)|\d{4}年.*房/,
    household: /个人|人住|口人|居住|独居|夫妻|孩子|老人|父母|宠物/,
    style: /风格|现代|简约|极简|北欧|中式|奶油|原木|法式|日式|美式/,
    budget: /预算|\d+(?:\.\d+)?\s*(?:万|元)/,
    timeline: /开工|入住|装修时间|明年|今年|个月|半年|年底/,
  };
  const topics: GuidanceQuestion[] = [
    { field: 'housing', text: '先聊聊你家的情况吧，新房还是旧房？' },
    { field: 'household', text: '平时有哪些人住，有特别想照顾的需要吗？' },
    { field: 'style', text: '喜欢什么样的风格？也可以直接发参考图。' },
    { field: 'budget', text: '预算有大致想法吗？没想好也没关系。' },
    { field: 'timeline', text: '时间上有什么想法？暂时未定也可以。' },
  ];
  let paused = false, interrupt = false, lastControl = false;
  for (const message of messages) {
    const text = message.text.trim();
    interrupt = isQuestion(text); lastControl = false;
    if (/^(继续整理|开始整理|继续了解)[。！!\s]*$/.test(text)) { paused = false; lastControl = true; continue; }
    if (/^(先暂停|暂停整理|不想填|先不聊|停止整理)[。！!\s]*$/.test(text)) { paused = true; lastControl = true; continue; }
    if (interrupt) paused = true;
    if (!text || isGreeting(text)) continue;
    const next = topics.find(q => !fields[q.field]?.text);
    let matched = false;
    for (const clause of text.split(/[，,。；;\n]/).map(s => s.trim()).filter(Boolean)) {
      if (isQuestion(clause) || referenceOnlyClause(clause)) continue;
      for (const k of requirementKeys) if (facts[k].test(clause)) {
        fields[k] = { text: Array.from(clause).slice(0, 1000).join(''), sourceMessageId: message.id, truncated: Array.from(clause).length > 1000 }; matched = true;
      }
      const room = clause.match(/(?:主卧|次卧|书房|客厅|卧室|厨房|阳台|卫生间)/)?.[0];
      if (room) { rooms.set(room, { text: clause, sourceMessageId: message.id }); matched = true; }
      else if (/书桌|靠窗|设备|台灯|电脑|办公|保留/.test(clause) && rooms.size === 1) {
        const name = [...rooms.keys()][0]; rooms.set(name, { text: name + '：' + clause, sourceMessageId: message.id }); matched = true;
      }
    }
    if (!matched && !paused && next && unknown.test(text)) {
      fields[next.field] = { text, sourceMessageId: message.id, truncated: false };
    } else if (!matched) paused = true;
    if (/还没想好|暂未确定|不确定|未定/.test(text)) paused = true;
  }
  if (rooms.size) {
    const values = [...rooms.values()], text = values.map(v => v.text).join('；');
    fields.room = { text: Array.from(text).slice(0, 1000).join(''), sourceMessageId: values.at(-1)!.sourceMessageId, truncated: text.length > 1000 };
  }
  const next = paused ? undefined : topics.find(q => !fields[q.field]?.text);
  return { fields, next, paused, interrupt, lastControl,
    reply: next ? '记下了。' + next.text : '记下了，你可以继续说想法，也可以随时换个话题。',
    recorded: [], pending: [], summaryReady: false, confirmed: [] };
}

const unknown = /^(还没确定|还没想好|还没定|暂未确定|暂时不确定|不确定|不知道|跳过|稍后补充)[。！!\s]*$/;
const matchers: Record<string, RegExp> = {
  housingType: /新房|旧房|二手房|毛坯房|精装房/,
  area: /\d+(?:\.\d+)?\s*(?:平方米|平米|㎡|平)|面积/,
  layout: /[一二两三四五六七八九十\d]+\s*(?:室|居)(?:[一二两三四五六七八九十\d]+厅)?/,
  occupants: /[一二两三四五六七八九十\d]+\s*(?:个人|口人|人)(?:住|居住)?/,
  needs: /办公|老人|父母|孩子|儿童|宠物|无特殊需求|暂无特殊需求/,
  style: /风格|现代|简约|极简|北欧|中式|奶油|原木|法式|日式|美式/,
  budget: /预算|\d+(?:\.\d+)?\s*万|\d+\s*元/,
  timeline: /开工|入住|装修时间|明年|今年|个月|半年|年底/,
  room: /书房|客厅|卧室|厨房|阳台|卫生间/,
  space: /靠窗|安静|布局|采光|靠墙/,
  usage: /办公|阅读|休息|学习|游戏/,
  frequency: /偶尔|每天|每日|每周|周末|频率/,
  devices: /电脑|台灯|显示器|打印机|手机充电|设备|暂时没有/,
};
function detailedProgress(g: Guidance, messages: Array<{ id: string; text: string }>, checkpoint?: GuidanceCheckpoint) {
  const answers: Record<string, { text: string; sourceMessageId: string; deferred: boolean }> = {};
  const confirmed = new Set<string>();
  const orderedQuestions = () => g.schemaVersion === 3 && (answers.room || answers.space)
    ? [...g.questions.filter(q => roomQuestionDefinitions.some(r => r.key === q.key)), ...g.questions.filter(q => !roomQuestionDefinitions.some(r => r.key === q.key))]
    : g.questions;
  const applyCheckpoint = () => {
    if (!checkpoint) return;
    for (const q of g.questions) {
      const value = checkpoint.fields[q.field];
      if (value === undefined) continue;
      answers[q.key!] = { text: value, sourceMessageId: '', deferred: !value || unknown.test(value) || /尚未确定|未定/.test(value) };
      if (!answers[q.key!].deferred) confirmed.add(q.key!);
    }
  };
  let paused = false, interrupt = false, lastControl = false;
  for (let index = 0; index < messages.length; index++) {
    if (checkpoint?.after === index) applyCheckpoint();
    const message = messages[index];
    const text = message.text.trim();
    interrupt = isQuestion(text); lastControl = false;
    if (/^(先暂停|暂停整理|不想填|先不聊|停止整理|先整理摘要)[。！!\s]*$/.test(text)) { paused = true; lastControl = true; continue; }
    if (/^(继续整理|开始整理|继续了解)[。！!\s]*$/.test(text)) { paused = false; lastControl = true; continue; }
    if (interrupt || isGreeting(text) || !text) continue;
    const pending = orderedQuestions().find(q => !answers[q.key!]);
    const put = (key: string, value: string) => { confirmed.delete(key); answers[key] = { text: Array.from(value).slice(0, 1000).join(''), sourceMessageId: message.id, deferred: unknown.test(value) || /还没定|还没确定|还没想好|暂未确定|尚未确定|不确定|未定/.test(value) }; };
    // An exact configured option belongs to the active question, even if its label
    // happens to contain a keyword used by another category.
    if (!paused && pending?.options?.includes(text)) { put(pending.key!, text); continue; }
    if (!paused && pending?.answerType === 'multiple' && text.split('、').every(s => pending.options?.includes(s))) { put(pending.key!, text); continue; }
    let matched = false;
    for (const clause of text.split(/[，,。；;\n]/).map(s => s.trim()).filter(Boolean)) {
      for (const q of g.questions) {
        if (matchers[q.key!]?.test(clause)) { put(q.key!, clause); matched = true; }
      }
    }
    if (!paused && pending && !matched) put(pending.key!, text);
  }
  if (checkpoint?.after === messages.length) applyCheckpoint();
  const fields = excerptRequirements([]);
  for (const field of g.schemaVersion === 3 ? allRequirementKeys : requirementKeys) {
    fields[field] ||= { text: '', sourceMessageId: null, truncated: false };
    const values = g.questions.filter(q => q.field === field).map(q => answers[q.key!]).filter(Boolean);
    if (values.length) {
      const combined = [...new Set(values.map(v => v.text))].join('；');
      fields[field] = { text: Array.from(combined).slice(0, 1000).join(''), sourceMessageId: values[values.length - 1].sourceMessageId, truncated: Array.from(combined).length > 1000 };
    }
  }
  const next = orderedQuestions().find(q => !answers[q.key!]);
  const definitions = [...questionDefinitions, ...roomQuestionDefinitions];
  const label = (q: GuidanceQuestion) => definitions.find(d => d.key === q.key)!.label;
  const recorded = g.questions.filter(q => answers[q.key!] && !answers[q.key!].deferred).map(label);
  const pending = g.questions.filter(q => !answers[q.key!] || answers[q.key!].deferred).map(label);
  const summaryReady = g.schemaVersion === 3 && Object.keys(answers).length >= 3;
  const reply = paused ? '好的，先暂停整理。可以打开“需求摘要”先核对，需要时说“继续整理”。' : next ? next.text + (summaryReady ? '\n已说过的先记下，不用填满；你可以随时打开“需求摘要”。' : '') : g.completion;
  return { fields, next, paused, interrupt, lastControl, reply, recorded, pending, summaryReady, confirmed: g.questions.filter(q => confirmed.has(q.key!)).map(label) };
}

/** Server-derived view; never infer progress from the client's paginated messages. */
export function guidanceView(g: Guidance | null, messages: Array<{ id: string; text: string }>, checkpoint?: GuidanceCheckpoint) {
  if (!g?.enabled || !g.schemaVersion || messages.length > 200) return null;
  if (g.chatFirst) return null;
  const p = detailedProgress(g, messages, checkpoint);
  return { questionKey: p.paused ? null : p.next?.key || null,
    options: p.paused || p.next?.answerType === 'text' ? [] : (p.next?.options || []).filter(s => p.next?.skippable !== false || !unknown.test(s)), recorded: p.recorded.join('、') || '暂无',
    pending: p.pending.join('、') || '暂无', paused: p.paused, answerType: p.next?.answerType || 'single', skippable: p.next?.skippable !== false,
    summaryReady: p.summaryReady, confirmed: p.confirmed.join('、') || '暂无' };
}
