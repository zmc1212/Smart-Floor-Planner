import { fail, id } from '@/lib/assistant/contracts';
import { object, text } from '../contracts';
import { noPublicPii, publicRevision } from '../public-contract';

export const liveAudience = '进入本企业公开工地页的访客，包括通过分享链接进入的人';
export const liveScope = '仅此机位的无声实时画面，不含历史回放、抓拍、下载或云台控制';
export const liveLabels: Record<string, string> = { draft: '草稿', pending_owner: '待你决定', owner_approved: '已同意，待企业审核', published: '公开中', declined: '暂不公开', rejected: '审核退回', withdrawn: '直播已停止公开' };
export function liveDraft(input: unknown) {
  const v = object(input, ['expectedRevision','bindingId','alias','name']);
  return { expectedRevision: publicRevision(v.expectedRevision), bindingId: id(v.bindingId), alias: noPublicPii(text(v.alias, 40)), name: noPublicPii(text(v.name, 80)) };
}
export function liveDecision(input: unknown) {
  const v = object(input, ['expectedRevision','versionId','reason']);
  return { expectedRevision: publicRevision(v.expectedRevision), versionId: id(v.versionId), reason: text(v.reason || '', 500, false) };
}
export function liveKey(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{48}$/.test(input)) fail('public_live_unavailable',404);
  return input;
}
export function liveResource(input: string) {
  if (!/^[a-zA-Z0-9_/-]+\.(m3u8|ts|m4s|mp4)$/.test(input) || input.startsWith('/') || input.includes('//') || input.includes('..')) fail('public_live_unavailable',404);
  return input;
}
