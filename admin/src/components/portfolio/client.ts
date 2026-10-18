import type { WorkContent, DesignerProfile } from '@/lib/portfolio/contracts';
export type WorkRow = { id: string; kind: string; author_id: string | null; author_name: string; head_version_id: string; published_version_id: string | null; withdrawn: boolean; version: number; status: string; content: WorkContent; review_note: string; number: number; updated_at: string };
export type WorkVersion = { id: string; number: number; status: string; content: WorkContent; review_note: string; published_at: string | null };
export type WorkDetail = { work: WorkRow; head: WorkVersion; versions: WorkVersion[]; manager: boolean; assets: Array<{ id: string; content_hash: string }>; audits: Array<{ id: string; action: string; note: string; created_at: string }> };
export type Author = { id: string; display_name: string; professional_title: string | null; professional_profile_locked: boolean };
export type Profile = { content: DesignerProfile; version: number };
export type Community = { id: string; name: string; city_code: string; city_name: string; district: string; address: string; provider: string };
export const statusLabels: Record<string, string> = { draft: '草稿', submitted: '待审核', returned: '已退回', published: '已发布', withdrawn: '已下架' };
const errors: Record<string, string> = {
  invalid_portfolio: '请检查内容长度、必填项和图片分组后重试。', invalid_image_group: 'AI 图片只能归为效果图，样板间只能归为实拍图。',
  portfolio_not_ready: '请选择作品图片并设置封面后再提交。', portfolio_forbidden: '当前账号无此操作权限，请联系企业管理员。',
  portfolio_not_found: '作品不存在或当前账号无权访问。', portfolio_unavailable: '作品服务暂不可用，请稍后重试。',
  portfolio_author_unavailable: '作者不是本企业在职设计师，请核对员工状态。', portfolio_draft_required: '请先创建新草稿，待审核版本不能直接修改。',
  portfolio_rights_expired: '图片许可已过期，请更新有效授权后重新提交。', portfolio_reference_not_original: '企业授权参考不能展示为设计师原创作品，请取消「设计师主页」。',
  portfolio_asset_unavailable: '图片已失效或不属于本作品，请重新选择。', portfolio_asset_limit: '本作品上传图片已达上限，请新建作品或联系管理员整理。',
  invalid_portfolio_image: '请选择4MB以内的PNG/JPEG图片；图片过大或格式无效。', version_conflict: '记录已变化，请刷新核对；当前输入会保留。',
  idempotency_conflict: '提交信息与原请求不一致，请刷新核对。', invalid_message: '提交信息不完整，请核对后重试。',
  'Please select an enterprise first': '请先在顶部选择企业后再维护作品。',
  invalid_community_city: '请重新选择有效的所在城市，再搜索小区。', invalid_community_query: '选择城市后至少输入两个字搜索小区。',
  community_provider_unconfigured: '地图查询尚未配置。可使用企业核验名录或暂不绑定。', community_provider_unavailable: '地图查询超时或暂不可用，可重试或暂不绑定。',
  community_provider_disabled: '地图服务尚未启用，请平台管理员在「地图服务配置」中设置；当前作品可暂不绑定继续保存。',
  community_provider_denied: '地图供应商账号权限不可用，请由管理员核对；当前作品仍可保存。', community_provider_quota: '地图供应商配额已达上限，外部查询已暂停。可使用核验名录或暂不绑定。',
  community_rate_limited: '小区查询频率或当日用量已达上限，请稍后再试。', community_candidate_invalid: '小区候选已过期或不符合住宅区条件，请重新搜索点选。',
  community_candidate_changed: '供应商小区信息已变化，请重新搜索并确认具体分期。', Unauthorized: '登录已失效，请重新登录。', Forbidden: '当前账号无权访问。',
};
class PortfolioRequestError extends Error { constructor(readonly uncertain: boolean, message: string) { super(message); } }
export async function portfolioRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/portfolio/' + path, { ...init, cache: 'no-store', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); }
  catch (error) { if (init.signal?.aborted) throw error; throw new PortfolioRequestError(true, '连接中断，提交结果待核对。请用原操作重试或刷新核对。'); }
  let payload;
  try { payload = await response.json(); } catch { throw new PortfolioRequestError(true, '响应中断，提交结果待核对，请重试原操作。'); }
  if (!response.ok || !payload.success) throw new PortfolioRequestError(response.status >= 500, errors[payload.error] || '操作失败，请稍后重试。');
  return payload.data as T;
}
export class PortfolioMutations {
  private pending = new Map<string, string>();
  async write<T>(path: string, body: object, method = 'POST'): Promise<T> {
    const signature = JSON.stringify([path, method, body]), key = this.pending.get(signature) || crypto.randomUUID();
    this.pending.set(signature, key);
    try {
      const result = await portfolioRequest<T>(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
      this.pending.delete(signature); return result;
    } catch (error) { if (error instanceof PortfolioRequestError && !error.uncertain) this.pending.delete(signature); throw error; }
  }
}
export function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
export function assetUrl(workId: string, assetId: string) { return `/api/portfolio/works/${workId}/assets/${assetId}`; }
