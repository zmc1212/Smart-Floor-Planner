export type ReportPage = { id: string; title: string; body: string; assetIds: string[] };
export type ReportDraft = {
  title: string;
  purpose: 'proposal' | 'comparison' | 'revision' | 'final';
  mode: 'scroll' | 'slides';
  outlineConfirmed: boolean;
  pages: ReportPage[];
};
export type ReportAsset = { id: string; title: string; kind: 'design' | 'site' | 'plan'; url: string };
export const REPORT_PURPOSES = { proposal: '初次提案', comparison: '方案比选', revision: '修改复盘', final: '最终方案汇报' };
export class ReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function parseDraft(value: unknown): ReportDraft {
  const draft = value as ReportDraft;
  if (!draft || typeof draft !== 'object' || typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 100
    || !Object.hasOwn(REPORT_PURPOSES, draft.purpose) || !['scroll', 'slides'].includes(draft.mode)
    || typeof draft.outlineConfirmed !== 'boolean' || !Array.isArray(draft.pages) || !draft.pages.length || draft.pages.length > 30) {
    throw new ReportError('请填写汇报标题，并保留 1–30 个章节');
  }
  const ids = new Set<string>();
  const pages = draft.pages.map((page) => {
    if (!page || typeof page.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(page.id) || ids.has(page.id)
      || typeof page.title !== 'string' || !page.title.trim() || page.title.length > 100
      || typeof page.body !== 'string' || page.body.length > 3000 || !Array.isArray(page.assetIds)
      || page.assetIds.length > 4 || page.assetIds.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id))) {
      throw new ReportError('章节格式无效：标题最多 100 字、正文最多 3000 字，每页最多 4 张图片');
    }
    ids.add(page.id);
    return { id: page.id, title: page.title.trim(), body: page.body, assetIds: [...new Set(page.assetIds)] };
  });
  return { title: draft.title.trim(), purpose: draft.purpose, mode: draft.mode, outlineConfirmed: draft.outlineConfirmed, pages };
}
export function reportAssetIds(draft: ReportDraft) { return [...new Set(draft.pages.flatMap((page) => page.assetIds))]; }
export function assertReportAssets(draft: ReportDraft, assets: ReportAsset[]) {
  const allowed = new Set(assets.map((asset) => asset.id));
  if (reportAssetIds(draft).some((id) => !allowed.has(id))) throw new ReportError('部分素材已删除、撤回或不属于当前客户，请重新选择', 409);
}
export function initialDraft(title: string, purpose: ReportDraft['purpose']): ReportDraft {
  const headings = {
    proposal: ['项目与需求', '现场与户型', '设计方向', '重点空间', '待确认事项'],
    comparison: ['本次比选目标', '方案一', '方案二', '方案取舍', '待确认事项'],
    revision: ['本次修改目标', '客户反馈', '调整前', '调整后', '待确认事项'],
    final: ['项目概览', '户型与布局', '分空间设计', '已确认内容', '实施前待确认事项'],
  };
  return { title, purpose, mode: 'scroll', outlineConfirmed: false, pages: headings[purpose].map((title, i) => ({ id: `page-${i + 1}`, title, body: '', assetIds: [] })) };
}
export function canManageReport(role: string, staffId: string, assignedTo: bigint | null) {
  return ['admin', 'super_admin', 'enterprise_admin'].includes(role) || (role === 'designer' && assignedTo?.toString() === staffId);
}

export function parseReportSuggestion(advice: string, kind: 'outline' | 'page') {
  if (kind === 'page') {
    const body = advice.trim();
    if (!body || body.length > 3000) throw new ReportError('模型返回的正文为空或过长，请缩短要求后重试');
    return body;
  }
  const titles = advice.split(/\r?\n/).map((line) => line.replace(/^\s*(?:\d+[.、)]|[-*#])\s*/, '').trim()).filter(Boolean);
  if (titles.length < 3 || titles.length > 10 || titles.some((title) => title.length > 100) || new Set(titles).size !== titles.length) throw new ReportError('模型返回的大纲格式不符合要求，请重新生成');
  return titles;
}
