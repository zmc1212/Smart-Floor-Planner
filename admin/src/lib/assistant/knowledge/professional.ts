import { fail } from '../contracts';
import type { Applicability, KnowledgeContext, ProfessionalKnowledge } from '../contracts/professional';

export const professionalKinds = { construction: '施工工艺/检查', material: '材料/设备', service: '企业服务/制度', explanation: '专业解释', internal: '内部培训/流程' };
export const conditionFields = { stage: '实际阶段', room: '房间', material: '材料/型号', city: '城市' };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid_professional_knowledge',422);
  return value as Record<string,unknown>;
}
function text(value: unknown, max: number, multiline=false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (multiline?value.includes('\0'):/[\0\r\n]/.test(value))) fail('invalid_professional_knowledge',422);
  return value.trim();
}
function list(value: unknown, max: number, length: number) {
  if (!Array.isArray(value) || value.length > max) fail('invalid_professional_knowledge',422);
  return [...new Set(value.map(v => text(v,length)))];
}
/** Server supplies review identity/time on save. A note records review, not engineering certification. */
export function professionalKnowledge(value: unknown, reviewer?: {adminId:string; reviewedAt:string}): ProfessionalKnowledge | null {
  if (value == null) return null;
  const v=object(value,['version','kind','topics','conditions','prerequisites','exceptions','origin','claim','review']);
  if (v.version !== 1 || !Object.hasOwn(professionalKinds,String(v.kind)) || !Array.isArray(v.conditions) || v.conditions.length > 8) fail('invalid_professional_knowledge',422);
  const origin=object(v.origin,['title','version','locator','authority']);
  if (!['enterprise_rule','manufacturer','reference'].includes(String(origin.authority))) fail('invalid_professional_knowledge',422);
  const review=object(v.review,['note','adminId','reviewedAt']);
  const stamp=reviewer || {adminId:text(review.adminId,19),reviewedAt:text(review.reviewedAt,40)};
  if (!/^[1-9]\d{0,18}$/.test(stamp.adminId) || !Number.isFinite(Date.parse(stamp.reviewedAt))) fail('invalid_professional_knowledge',422);
  const conditions=v.conditions.map(raw => {
    const c=object(raw,['field','operator','values']);
    if (!Object.hasOwn(conditionFields,String(c.field)) || !['in','not_in'].includes(String(c.operator))) fail('invalid_professional_knowledge',422);
    const values=list(c.values,12,80); if (!values.length) fail('invalid_professional_knowledge',422);
    return {field:c.field,operator:c.operator,values} as ProfessionalKnowledge['conditions'][number];
  });
  if (new Set(conditions.map(c=>c.field+':'+c.operator)).size!==conditions.length) fail('invalid_professional_knowledge',422);
  const claim=v.claim == null ? null : object(v.claim,['key','value']);
  const result:ProfessionalKnowledge={version:1,kind:v.kind as ProfessionalKnowledge['kind'],topics:list(v.topics,12,80),conditions,
    prerequisites:list(v.prerequisites,12,300),exceptions:list(v.exceptions,12,300),
    origin:{title:text(origin.title,200),version:text(origin.version,100),locator:text(origin.locator,200),authority:origin.authority as ProfessionalKnowledge['origin']['authority']},
    claim:claim?{key:text(claim.key,100),value:text(claim.value,200)}:null,review:{note:text(review.note,500,true),...stamp}};
  if (Buffer.byteLength(JSON.stringify(result))>15000) fail('invalid_professional_knowledge',422);
  return result;
}
export function professionalText(p: ProfessionalKnowledge) {
  return [`专业类型：${professionalKinds[p.kind]}`,p.topics.length?'主题/同义表达：'+p.topics.join('、'):'',
    ...p.conditions.map(c=>`${conditionFields[c.field]}${c.operator==='in'?'适用':'不适用'}：${c.values.join('、')}`),
    ...p.prerequisites.map(s=>'前置条件：'+s),...p.exceptions.map(s=>'例外/限制：'+s),
    `依据：${p.origin.title}；来源版本：${p.origin.version}；章节/条目：${p.origin.locator}`,
    `依据性质：${p.origin.authority==='enterprise_rule'?'企业规则':p.origin.authority==='manufacturer'?'厂家资料':'参考解释'}`,
    p.claim?`规则主题：${p.claim.key}；明确口径：${p.claim.value}`:''].filter(Boolean).join('\n');
}
/** Missing facts stay unknown. Only current server-resolved stages are classified in KB-1. */
export function applicability(p: ProfessionalKnowledge, context: KnowledgeContext): Applicability {
  const result:Applicability={status:'applicable',matched:[],missing:[],mismatched:[]};
  for (const c of p.conditions) {
    const actual=c.field==='stage'?context.stage:undefined;
    if (!actual) {result.missing.push(conditionFields[c.field]);continue;}
    const included=c.values.includes(actual), match=c.operator==='in'?included:!included;
    (match?result.matched:result.mismatched).push(`${conditionFields[c.field]}：${actual}；${c.operator==='in'?'要求':'排除'} ${c.values.join('、')}`);
  }
  result.status=result.mismatched.length?'not_applicable':result.missing.length?'unknown':'applicable';return result;
}
