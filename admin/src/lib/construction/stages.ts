import { fail, id } from '@/lib/assistant/contracts';
import { object, text } from './contracts';
import { factFields, type NeedFact } from '@/lib/assistant/agent/memory';

export type NeedFollowUp = { field: NeedFact['field']; room: string; question: string };
export type ConstructionStage = { key: string; name: string; visitReminder: boolean; visitReason: string; watchPoints: string; followUps?: NeedFollowUp[] };
export type StageContact = { name: string; phone: string };
export function assignmentInput(staffIds: unknown, primaryStaffId: unknown) {
  if (!Array.isArray(staffIds) || staffIds.length > 30) fail('invalid_construction', 422);
  const ids = staffIds.map(id);
  if (new Set(ids).size !== ids.length) fail('invalid_construction', 422);
  const primary = primaryStaffId ? id(primaryStaffId) : ids.length === 1 ? ids[0] : null;
  if (primary && !ids.includes(primary)) fail('invalid_construction', 422);
  return { ids, primary };
}
export const defaultConstructionStages: ConstructionStage[] = [
  ['preparation', '前期'], ['design', '设计'], ['demolition', '拆改'], ['utilities', '水电'],
  ['masonry_carpentry', '泥木'], ['painting', '油漆'], ['installation', '安装'], ['furnishing', '软装'],
  ['completion', '完工'], ['move_in', '入住'],
].map(([key, name]) => ({ key, name, visitReminder: false, visitReason: '', watchPoints: '' }));
export function stageKey(raw: unknown) {
  if (typeof raw !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw)) fail('invalid_construction', 422);
  return raw;
}
export function stagesInput(raw: unknown): ConstructionStage[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 30) fail('invalid_construction', 422);
  const stages = raw.map(item => {
    const v = object(item, ['key', 'name', 'visitReminder', 'visitReason', 'watchPoints', 'followUps']);
    if (typeof v.visitReminder !== 'boolean') fail('invalid_construction', 422);
    const followUps = v.followUps === undefined ? undefined : followUpsInput(v.followUps);
    return { key: stageKey(v.key), name: text(v.name, 30), visitReminder: v.visitReminder,
      visitReason: text(v.visitReason ?? '', 500, v.visitReminder), watchPoints: text(v.watchPoints ?? '', 2000, v.visitReminder),
      ...(followUps === undefined ? {} : { followUps }) };
  });
  if (new Set(stages.map(s => s.key)).size !== stages.length || new Set(stages.map(s => s.name)).size !== stages.length) fail('invalid_construction', 422);
  return stages;
}
function followUpsInput(raw: unknown): NeedFollowUp[] {
  if (!Array.isArray(raw) || raw.length > 3) fail('invalid_construction', 422);
  const prompts = raw.map(item => {
    const p = object(item, ['field', 'room', 'question']);
    if (!factFields.includes(p.field as NeedFact['field'])) fail('invalid_construction', 422);
    const field = p.field as NeedFact['field'], room = text(p.room ?? '', 40, false), question = text(p.question, 300);
    if ((['housing','household','budget','timeline'].includes(field) && room)
      || (!['housing','household','style','budget','timeline'].includes(field) && !room)
      || (room && !question.includes(room))) fail('invalid_construction', 422);
    return { field, room, question };
  });
  if (new Set(prompts.map(p => JSON.stringify([p.field, p.room]))).size !== prompts.length) fail('invalid_construction', 422);
  return prompts;
}
export function contactInput(name: unknown, phone: unknown): StageContact {
  const contact = { name: text(name, 50, false), phone: text(phone, 30, false).replace(/[\s()-]/g, '') };
  if ((!contact.name !== !contact.phone) || (contact.phone && !/^\+?\d{5,20}$/.test(contact.phone))) fail('invalid_construction_phone', 422);
  return contact;
}
export function stageReminder(project: string, stage: ConstructionStage, note: string) {
  return `「${project}」当前施工已进入${stage.name}阶段。\n${stage.visitReason}\n到现场重点看：\n${stage.watchPoints}${note ? '\n现场补充：' + note : ''}\n如需到场，请先与当前阶段施工人员电话沟通时间。`;
}
