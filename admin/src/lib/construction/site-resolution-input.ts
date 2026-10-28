import type { ResolutionCommand } from './site-resolution';

export type NaturalResolutionFields = { planId: string; recordId: string; excerpt: string };
export type NaturalResolutionAction = 'implement' | 'resolve' | 'close';
/** Select only an explicitly quoted customer excerpt and an explicit original
 * policy. Internal conclusions and arbitrary model summaries never become it. */
export function naturalResolutionInput(original: string, action: NaturalResolutionAction, issueId: string, fields: NaturalResolutionFields, mediaIds: string[] = []) {
  const missing = [original.length <= 1200 ? '' : '1200字内的完整处理原话', mediaIds.length ? '请先把新照片核对发布为现场记录，再提交本次处理' : ''].filter(Boolean);
  if (action === 'implement') {
    if (!/^[1-9]\d{0,18}$/.test(fields.planId)) missing.push('同事项当前已同意方案');
    if (!/^[1-9]\d{0,18}$/.test(fields.recordId)) missing.push('同房间已核对发布的完成记录');
    if (fields.excerpt) missing.push('落实不同时回传客户节选，请另由管理者核对解决');
    return { missing, command: missing.length ? undefined : { action, issueId, planId: fields.planId, recordId: fields.recordId, conclusion: original } as ResolutionCommand };
  }
  const quotation = /(?:给业主(?:说|回传)|(?:回传|告诉)业主)[：:\s]*[“「"]([^”」"]+)[”」"]/g;
  const excerpts = [...original.matchAll(quotation)].map(m => m[1]);
  if (!fields.excerpt || excerpts.length !== 1 || excerpts[0] !== fields.excerpt) missing.push('明确给业主说的一段带引号原文');
  const clauses = original.replace(quotation, '').split(/[，,。；;！？!?\n]/).map(c => c.trim());
  const share = ['把本次落实照片原件也回传给业主', '把本次落实原图也发给业主'].some(c => clauses.includes(c));
  const withhold = ['只回传文字', '不要回传原图', '本次不回传原图'].some(c => clauses.includes(c));
  if (share === withhold) missing.push('明确只回传文字或是否回传本次落实原图');
  if (fields.planId || fields.recordId) missing.push('解决／关闭沿用已核对落实依据，不能同时替换方案或记录');
  return { missing, command: missing.length ? undefined : { action, issueId, conclusion: original, excerpt: fields.excerpt, originals: share } as ResolutionCommand };
}
