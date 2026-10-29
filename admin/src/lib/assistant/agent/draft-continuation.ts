import { fingerprint, fail } from '../contracts';
import { bailianPartialCapable, type BailianBinding } from '@/lib/ai/providers/bailian-capabilities';

export type ApprovedDraft = { prefix: string; version: number; prefixHash: string; expiresAt: string;
  enterpriseId: string; ownerId: string; knowledgeEpoch: number; consentVersion: number; status: 'approved' | 'revoked' };
const completionClaim = /已(?:经)?(?:保存|提交|确认|安排|通知|修改|删除|支付|扣款)|保存成功|确认成功/;
export function validateDraft(draft: ApprovedDraft, current: {
  enterpriseId: string; ownerId: string; version: number; knowledgeEpoch: number; consentVersion: number;
}, now = Date.now()) {
  if (draft.status !== 'approved' || draft.enterpriseId !== current.enterpriseId || draft.ownerId !== current.ownerId
    || draft.version !== current.version || draft.knowledgeEpoch !== current.knowledgeEpoch || draft.consentVersion !== current.consentVersion
    || !Number.isFinite(Date.parse(draft.expiresAt)) || Date.parse(draft.expiresAt) <= now
    || !draft.prefix.trim() || Buffer.byteLength(draft.prefix) > 12000 || fingerprint(draft.prefix) !== draft.prefixHash
    || completionClaim.test(draft.prefix)) fail('draft_continuation_stale', 409);
}
/** Dedicated Partial Mode wire shape. Never used for normal chat, JSON output,
 * business actions or replay of a previous indeterminate model request. A model
 * whose table does not record Partial support is rejected here; the current
 * Qwen3.8 protocol conflict additionally stays fenced by the durable service. */
export function partialBody(binding: BailianBinding, prefix: string) {
  if (binding.thinking || !bailianPartialCapable(binding.model) || !prefix.trim()
    || Buffer.byteLength(prefix) > 12000 || completionClaim.test(prefix)) fail('invalid_draft_prefix',422);
  return { model: binding.model, enable_thinking: false, max_tokens: 512,
    messages: [{ role: 'user', content: '继续这份已获权的装修说明草稿，只续写文字，不执行或宣称完成任何业务操作。' },
      { role: 'assistant', content: prefix, partial: true }] };
}
export function joinDraft(prefix: string, suffix: string) {
  if (!suffix.trim() || suffix.startsWith(prefix) || Buffer.byteLength(prefix + suffix) > 20000
    || completionClaim.test(suffix)) fail('invalid_draft_continuation',502);
  return prefix + suffix;
}
