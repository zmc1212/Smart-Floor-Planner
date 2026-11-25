export type PublicAssistantPrompt = {
  title: string;
  text: string;
};

export type PublicAssistantConfig = {
  enabled: boolean;
  opening: string;
  prompts: PublicAssistantPrompt[];
  version: number;
};

/** Canonical runtime projection used by the public XiaoK entry. */
export type PublicXiaokConfig = {
  enabled: boolean;
  guidanceOpening: string;
  publicTopics: PublicAssistantPrompt[];
  version: number;
};

export const DEFAULT_PUBLIC_ASSISTANT_CONFIG: PublicAssistantConfig = {
  enabled: false,
  opening: '你好，我是小K。你可以先问我装修规划、风格选择、材料和施工常识。',
  prompts: [
    { title: '装修先做什么', text: '第一次装修，应该先从哪一步开始？' },
    { title: '小户型收纳', text: '小户型怎么规划收纳，才能住得更舒服？' },
    { title: '找设计师', text: '我想找一个适合我的设计师' },
  ],
  version: 1,
};
