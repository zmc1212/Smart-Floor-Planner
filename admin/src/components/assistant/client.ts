const messages: Record<string, string> = {
  invalid_reference_case: '请填写案例出处、授权凭据、1–12个方向标签、400字以内说明，并选择4MB以内的JPEG/PNG独立图片。',
  reference_unavailable: '案例未发布、已撤回或不对客户开放，请重新核对当前版本。',
  assistant_disabled: '本企业尚未开启小 K，或试点额度与保留期尚未配置。',
  assistant_capability_forbidden: '当前账号未获小 K 知识管理权限。',
  assistant_resource_not_found: '记录不存在或当前账号无权访问，请刷新列表。',
  version_conflict: '资料已被更新，请重新读取后再操作；你的输入仍保留。',
  idempotency_conflict: '提交记录冲突，请刷新后核对结果。',
  knowledge_not_ready: '该版本尚未就绪，请检查索引、有效期和试问范围。',
  context_changed: '会话或知识范围已变化，请重新读取；必要时新建试问。',
  conversation_busy: '当前会话正在回答，请等待完成后再发送。',
  assistant_quota_exceeded: '本企业当前额度或请求频率已达上限，请稍后再试。',
  invalid_message: '请检查必填内容、长度及有效期后重新提交。',
  model_unavailable: '回答服务暂不可用，请稍后重试。',
  retrieval_unavailable: '知识检索暂不可用，请稍后重试。',
  identity_context_invalid: '登录身份已失效，请重新登录。',
  Unauthorized: '登录已失效，请重新登录。', Forbidden: '当前账号无权访问此功能。',
};
export class AssistantRequestError extends Error {
  constructor(readonly code: string, readonly status: number, readonly uncertain = false) {
    super(messages[code] || (uncertain ? '连接中断，提交结果尚未确认。请用原操作重试，或刷新核对状态。' : '小 K 服务暂不可用，请稍后重试。'));
  }
}
export function assistantError(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
export function runIsActive(run: { status: string } | null | undefined) { return Boolean(run && ['queued', 'running'].includes(run.status)); }

export async function assistantRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const timeout = AbortSignal.timeout(30000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try { response = await fetch(`/api/assistant/${path}`, { ...init, signal, cache: 'no-store' }); }
  catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AssistantRequestError('network_unknown', 0, true);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new AssistantRequestError('response_unknown', response.status, true); }
  if (!response.ok || !payload.success) throw new AssistantRequestError(payload.code || payload.error || 'assistant_unavailable', response.status, response.status >= 500);
  return payload.data as T;
}

/** Keep the same key after a lost response. No transcript/credentials in browser storage. */
export class AssistantMutations {
  private pending = new Map<string, string>();
  async write<T>(path: string, body: object, method = 'POST', explicitKey?: string): Promise<T> {
    const signature = JSON.stringify([method, path, body]);
    const key = this.pending.get(signature) || explicitKey || crypto.randomUUID();
    this.pending.set(signature, key);
    try {
      const result = await assistantRequest<T>(path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
      this.pending.delete(signature);
      return result;
    } catch (error) {
      if (error instanceof AssistantRequestError && !error.uncertain) this.pending.delete(signature);
      throw error;
    }
  }
}

export const audienceLabels = { customer_public: '客户可见资料', staff_internal: '内部资料', all: '全部资料' };
export const statusLabels: Record<string, string> = { draft: '草稿', active: '已发布', retired: '已撤回', pending: '待索引', indexing: '索引中', ready: '索引就绪', queued: '排队中', running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消', indeterminate: '结果待核对', open: '进行中', archived: '已归档', closed: '已关闭' };
export function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
