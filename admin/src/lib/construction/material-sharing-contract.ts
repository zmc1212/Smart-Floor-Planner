import { z } from 'zod';
import type { ModelTool } from '@/lib/assistant/contracts/model';

export const materialShareInputSchema = z.object({ project: z.string().max(100), room: z.string().max(100), kind: z.enum(['need', 'drawing']),
  sourceMessageId: z.string().regex(/^(?:[1-9]\d{0,18})?$/), excerpt: z.string().max(2000) }).strict();
export const materialSharingTools: ModelTool[] = [
  { name: 'prepare_material_share', description: '客户希望把本咨询的需求节选或刚上传的点位图交给项目人员时，准备一份私有共享预览，不直接授权。project/room用明确项目名/房间名，不清楚传空串由服务澄清；sourceMessageId用本咨询客户原话ID，本轮原话可传空串，excerpt逐字摘录要共享的原话/本图说明。指定设计师或个人不等于同意项目团队；实际可用受众只有本项目全体有效成员（含观察员和获权管理者），必须先展示该范围，再由客户明确确认；不要调用接待工具代替共享。', parameters: {
    type: 'object', properties: { project: { type: 'string', maxLength: 100 }, room: { type: 'string', maxLength: 100 },
      kind: { type: 'string', enum: ['need', 'drawing'] }, sourceMessageId: { type: 'string' }, excerpt: { type: 'string', maxLength: 2000 } },
    required: ['project', 'room', 'kind', 'sourceMessageId', 'excerpt'], additionalProperties: false } },
  { name: 'revoke_material_share', description: '客户明确要停止或撤回本咨询某份已共享资料时撤回原授权。grantId只用本咨询真实资料号；不明用空串让服务澄清。quote逐字摘本轮停止共享请求，否定/假设/询问不执行。不能撤回别的客户、别的咨询资料。', parameters: {
    type: 'object', properties: { grantId: { type: 'string' }, quote: { type: 'string', maxLength: 1000 } }, required: ['grantId', 'quote'], additionalProperties: false } },
];

export function materialSharingRequested(text: string) {
  return /共享|分享|发给|转给|传给|提供给|同步给|发到|传到|(?:给|让).{0,30}(?:看|知道)|(?:取消|撤回|停止).{0,20}(?:资料|图纸|需求)/.test(text);
}

/** Bounded receipt guard; a model never supplies evidence that access changed. */
export function materialShareCompletionClaim(text: string) {
  return /已(?:经)?(?:共享|分享|发给|转给|发送给|通知|开放|撤回|取消共享)|已(?:经)?(?:将|把).{0,160}(?:共享|发给|转给|发送给|通知)|(?:共享|分享|发送|撤回)(?:成功|完成)|完成(?:了)?共享/.test(text);
}
export function restrictedMaterialAudience(text: string) {
  return /只给|仅给|只让|仅让|仅限|不要给|不能给|别给|不让|不要让|别让|除.+外|只有.+(?:能|可|看)/.test(text);
}
export function materialShareAcknowledgement(text: string) {
  return /^(?:好|好的|可以|行|同意|确认|我同意|没问题|收到|知道了|了解了)[。！!\s]*$/.test(text.trim());
}

/** Only a whole deictic cancellation refers to the current preview. Named
 * projects/rooms/kinds and explicit IDs must resolve through the grant service. */
export function materialShareCurrentCancellation(text: string) {
  return /^(?:(?:请|现在|帮我)?(?:取消|停止|撤回)(?:这次|本次)?共享(?:这次资料|本次资料|这份资料|这张图|这份需求)?|(?:别|不要|不用|不想)(?:再)?共享(?:了)?)[。！!\s]*$/.test(text.trim());
}

export function materialShareReplyIntent(text: string): 'confirm' | 'cancel' | null {
  if (/[？?]|如果|假如|是否|能否|能不能|可不可以|“|”|「|」|"/.test(text)) return null;
  if (/不要撤回|别撤回|不用撤回|不要取消|别取消/.test(text)) return null;
  if (/取消(?:这次|本次)?共享|停止共享|撤回共享|(?:别|不要|不用|不想)(?:再)?共享|不(?:同意|愿意)(?:共享|这个范围)/.test(text)) return 'cancel';
  if (restrictedMaterialAudience(text)) return null;
  // Match the whole authorization, not one positive fragment in a correction
  // or a selectively restricted audience. Unknown clauses remain private and
  // return to the existing Agent clarification path; they are never discarded.
  const team = '(?:本|这个|该|当前)?(?:项目|工地)(?:的)?(?:团队|全体成员|所有成员)';
  const item = '(?:这(?:一)?(?:段(?:需求|资料|话|内容)?|张(?:图|图片|点位图)?|份(?:资料|需求|内容)?|次(?:资料|内容|需求|共享)?|些(?:资料|内容))|本次(?:资料|内容|需求))';
  const prefix = '(?:(?:我)?(?:同意|确认)|可以|请|现在|就|愿意)?';
  const send = `(?:(?:(?:把|将)?${item})?(?:共享|分享|发|发送|转发)(?:给|到)?${team})`;
  const read = `(?:(?:让|允许|给)${team}(?:都)?(?:能|可以)?(?:看|看到)(?:${item})?)`;
  const toTeam = `(?:(?:给|向)${team}(?:共享|分享|发送|发|转发)(?:${item})?)`;
  const confirm = new RegExp(`^${prefix}(?:${send}|${read}|${toTeam})(?:吧|即可|就行|了)?$`);
  const otherPrivate = /^(?:其他|其它|其余)(?:私聊|聊天|内容|资料)(?:仍|继续)?(?:不共享|不分享|不要(?:共享|分享|发|发送)|不用(?:共享|分享|发|发送)|保持私有|继续保密)$/;
  const parts = text.split(/[，,。；;！!\n]/).map(p => p.replace(/\s+/g, '')).filter(Boolean);
  return parts.some(p => confirm.test(p)) && parts.every(p => confirm.test(p) || materialShareAcknowledgement(p) || otherPrivate.test(p)) ? 'confirm' : null;
}
