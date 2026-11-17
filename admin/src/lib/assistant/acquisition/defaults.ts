export type AcquisitionPrompt = { title: string; text: string };
export type AcquisitionConfig = {
  brandMode: 'anonymous' | 'branded';
  opening: string;
  prompts: AcquisitionPrompt[];
};

export const defaultAcquisitionConfig: AcquisitionConfig = {
  brandMode: 'anonymous',
  opening: '你好，我是小K。先说说你家的情况和想法，需要量房时再留下手机号，我会帮你安排。',
  prompts: [
    { title: '新房装修', text: '我家是新房，想先了解一下装修怎么开始' },
    { title: '旧房改造', text: '我家是旧房，想了解改造要先做什么' },
    { title: '预算安排', text: '想聊聊装修预算怎么安排' }
  ]
};
