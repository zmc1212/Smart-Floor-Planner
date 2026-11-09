import { fail } from '../../contracts';

export const agentV2SkillPack = 'v1';
export type AgentV2SkillSelection = { version: string; enabled: string[] };
type Skill = { id: string; version: number; title: string; instructions: string };

const catalog: readonly Skill[] = Object.freeze([
  { id: 'stage-reminder', version: 1, title: '施工阶段提醒',
    instructions: '客户问当前阶段、下一步或阶段注意事项时，先用query_business核对本人项目的实际阶段与记录；没有记录就说明无法确认，不猜阶段。企业工艺要点只在search_enterprise返回的授权原文中出现时引用并保留引用；没有企业依据时明确说是一般建议。不声称已完成、验收、批准或排期。' },
  { id: 'acceptance-points', version: 1, title: '验收要点',
    instructions: '客户问验收或检查要点时，先区分一般知识与本企业工艺。企业标准必须来自search_enterprise原文并引用，通用要点标为一般建议。可说明应检查的项目与条件，但不判断现场是否合格，不代替团队确认验收、整改完成或签字。' },
  { id: 'appointment-guidance', version: 1, title: '量房预约',
    instructions: '客户问量房或预约时，用query_business查询本人预约或方案的真实状态；只复述授权结果，不虚构时间、名额或确认。没有记录时说明暂未查到，可建议通过原入口预约或联系，但不声称已代为预约、改期或取消。' },
  { id: 'project-progress', version: 1, title: '项目进度',
    instructions: '客户问项目进度、方案、户型或施工记录时，用query_business读取本人获权记录，只按服务端返回的可读字段说明。区分已记录与未记录，不把计划当已完成，不承诺更新时间、交付日期或内部处理动作。' },
  { id: 'report-followup', version: 1, title: '日周报追问',
    instructions: '客户追问日/周报内容时，说明报告来自已保存的施工记录与获权照片，按原报告可读内容回答；没有记录如实说明缺项。聊天中不重新生成、补发或承诺投递报告，也不推断照片未显示的质量或验收结论。' },
]);
export const agentV2SkillIds = catalog.map(skill => skill.id);

export function parseAgentV2Skills(value: unknown): AgentV2SkillSelection | undefined {
  if (value === undefined) return;
  const selection = value as AgentV2SkillSelection;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || selection.version !== agentV2SkillPack || !Array.isArray(selection.enabled)
    || selection.enabled.length > catalog.length
    || selection.enabled.some(id => typeof id !== 'string' || !agentV2SkillIds.includes(id))
    || new Set(selection.enabled).size !== selection.enabled.length) fail('context_changed');
  return { version: selection.version, enabled: [...selection.enabled] };
}
export function agentV2Skills(selection: AgentV2SkillSelection | undefined) {
  if (!selection || selection.version !== agentV2SkillPack) return [];
  return catalog.filter(skill => selection.enabled.includes(skill.id));
}
/** Skill text only shapes explanation and clarification. Business facts,
 * actions and permissions still come exclusively from the authorized tools. */
export function agentV2SkillPrompt(selection: AgentV2SkillSelection | undefined) {
  const skills = agentV2Skills(selection);
  if (!skills.length) return null;
  return `【已启用技能｜${agentV2SkillPack}】以下SOP只约束回答结构与澄清方式，不授予任何工具、权限或业务动作；项目事实、来源和动作仍以授权工具结果及本项目权限为准，不得承诺预约、批准、验收、排期或报告投递。\n\n`
    .concat(skills.map((skill, index) => `${index + 1}. ${skill.title}（v${skill.version}）\n${skill.instructions}`).join('\n\n'));
}
