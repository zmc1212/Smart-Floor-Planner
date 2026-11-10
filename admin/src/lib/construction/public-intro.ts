import { fail } from '@/lib/assistant/contracts';
import type { OpeningConstraints } from '@/lib/assistant/fastgpt/agent-v2/openings';
import type { PublicContent } from './public-contract';

/** Only registry-approved fields leave the server. The snapshot is data for a
 * model to describe, never an instruction and never a business authorization. */
export function publicIntroFacts(content: PublicContent, input: readonly string[]) {
  const site: Record<string, unknown> = {};
  for (const field of input) {
    if (field === 'excerpts') site.excerpts = content.excerpts.map(excerpt => ({ role: excerpt.role, text: excerpt.text.replace(/\s+/g, ' ').trim(), date: excerpt.date }));
    else if (field === 'designerName') { if (content.designerName) site.designerName = content.designerName; }
    else if (['name', 'cityName', 'cityCode', 'district', 'stageName', 'photoCount'].includes(field))
      site[field] = (content as unknown as Record<string, unknown>)[field];
  }
  return JSON.stringify({ sourceRole: 'published_site_snapshot', site });
}

export const publicIntroPrompt = (maxChars: number) => '你是装修公司的助手小K。客户刚打开一个公开工地的围观页，这是系统进入事件，不是客户提问。'
  + '请根据用户消息中的公开快照写一段自然、具体、克制的开场白：说明现在能看到这个工地的哪些公开信息、当前阶段大致在做什么；'
  + `有公开署名设计师时可自然提到姓名。全文不超过${Math.max(40, maxChars - 25)}字，最后用一句邀请收尾。`
  + '只能使用快照里已有的信息，不补充、不推断项目细节。'
  + '不得承诺价格、工期、验收、可预约或已联系团队；不得说看过照片或描述照片内容；不得输出链接、引用标记、表格、标题或编号列表。'
  + '只输出开场白正文，不要解释你的做法。';

/** A run whose opening fails validation fails as a whole: no partial message,
 * no fallback copy pretending to be the model's words. */
export function validatePublicIntro(text: string, constraints: OpeningConstraints) {
  const value = text.replace(/\r\n?/g, '\n').trim();
  const length = Array.from(value).length;
  if (!value || length < constraints.minChars || length > constraints.maxChars) fail('invalid_model_answer', 502);
  if (constraints.noUrl && /https?:\/\/|www\./i.test(value)) fail('invalid_model_answer', 502);
  if (constraints.noCitationMarkers && (/\[[^\]]{0,40}\]\(/.test(value) || /\[[A-Z]\d{1,6}\]/.test(value))) fail('invalid_model_answer', 502);
  if (constraints.noPhotoClaims && /照片(里|中|上)|图(里|中)|我看到|画面(里|中)/.test(value)) fail('invalid_model_answer', 502);
  if (/1[3-9]\d{9}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value)) fail('invalid_model_answer', 502);
  if (/\|/.test(value) || /^#{1,6}\s/m.test(value) || value.split('\n').length > 4) fail('invalid_model_answer', 502);
  return value;
}
