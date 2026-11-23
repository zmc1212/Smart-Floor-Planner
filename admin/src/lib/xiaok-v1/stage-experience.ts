import { z } from 'zod';

const variable = z.strictObject({
  name: z.string().trim().min(1).max(30).refine(name => !/[{}]/u.test(name) && name !== '施工阶段'),
  value: z.string().max(160),
});
export const stageExperienceSchema = z.strictObject({
  welcome: z.string().max(1600),
  variables: z.array(variable).max(20).refine(items => new Set(items.map(v => v.name)).size === items.length),
  followUp: z.enum(['inherit', 'on', 'off']),
  followUpPrompt: z.string().trim().max(1200),
  guideEnabled: z.boolean(),
  lexicon: z.array(z.string().trim().min(1).max(200)).max(80).transform(words => [...new Set(words)]),
  prompt: z.string().trim().max(3200),
  historyRounds: z.number().int().min(1).max(20),
  maxTokens: z.number().int().min(128).max(2048),
  temperature: z.number().min(0).max(2),
  searchWeb: z.boolean(), readWeb: z.boolean(), knowledge: z.boolean(),
  searchMode: z.enum(['hybrid', 'keyword', 'vector']),
  attachments: z.boolean(), readAloud: z.boolean(),
}).refine(v => !v.guideEnabled || v.lexicon.length > 0, { path: ['lexicon'], message: '请至少添加一条输入引导问法' });
export type StageExperience = z.infer<typeof stageExperienceSchema>;
export function defaultStageExperience(): StageExperience {
  return { welcome:'', variables:[], followUp:'inherit', followUpPrompt:'', guideEnabled:false, lexicon:[], prompt:'',
    historyRounds:3, maxTokens:2048, temperature:0, searchWeb:true, readWeb:true, knowledge:true,
    searchMode:'hybrid', attachments:true, readAloud:false };
}
export function stageText(text: string, stage: string, variables: StageExperience['variables']) {
  const values = new Map([['施工阶段',stage], ...variables.map(v => [v.name,v.value] as [string,string])]);
  return text.replace(/\{\{([^{}]+)\}\}/gu, (token,key: string) => values.get(key.trim()) ?? token);
}
export function publicStageExperience(config: StageExperience, stage: string) {
  return { welcome:stageText(config.welcome,stage,config.variables), lexicon:config.guideEnabled ? config.lexicon : [],
    followUp:config.followUp, attachments:config.attachments, readAloud:config.readAloud };
}
export type StageEdit = { version: number; name: string; enabled: boolean; at: string };
