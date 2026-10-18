import type { Guidance } from './guidance';
export const legacyDefaultGuidance: Guidance = {
  enabled: true,
  opening: '你好，我是小K。我会一步步帮你梳理装修想法，没想好的可以说“还没确定”，也可以随时提问或说“先暂停”。',
  completion: '你的装修想法已经记下了。请点下方“需求摘要”，核对、修改并确认保存；还有想补充的也可以继续告诉我。',
  questions: [
    { field: 'housing', text: '先了解一下房屋情况：准备装修新房还是旧房？户型和面积大概是多少？' },
    { field: 'household', text: '家里准备住几个人？有没有老人、孩子、宠物，或者居家办公等需要特别考虑的需求？' },
    { field: 'style', text: '你喜欢什么装修风格或居住感觉？还没确定也没关系。' },
    { field: 'budget', text: '装修预算大概准备多少？可以说一个范围，还没定也可以先记下来。' },
    { field: 'timeline', text: '你计划什么时候装修或入住？有没有希望完成的时间？' },
  ],
};
export const questionDefinitions = [
  { key: 'housingType', field: 'housing', label: '新旧房', text: '这次准备装修新房还是旧房？', options: ['新房', '旧房', '还没确定'] },
  { key: 'area', field: 'housing', label: '房屋面积', text: '房子面积大约多少平方米？', options: ['还没确定'] },
  { key: 'layout', field: 'housing', label: '户型', text: '房子是几室几厅？', options: ['一室一厅', '两室一厅', '三室两厅', '还没确定'] },
  { key: 'occupants', field: 'household', label: '居住人数', text: '家里准备住几个人？', options: ['1人', '2人', '3人', '4人及以上', '还没确定'] },
  { key: 'needs', field: 'household', label: '居住需求', text: '居住上有没有需要特别照顾的需求？可以一起告诉我。', options: ['居家办公', '照顾老人', '儿童活动', '养宠物', '暂无特殊需求', '还没确定'] },
  { key: 'style', field: 'style', label: '风格', text: '你喜欢什么装修风格？', options: ['现代简约', '原木风', '奶油风', '还没确定'] },
  { key: 'budget', field: 'budget', label: '预算', text: '装修预算大概准备多少？可以说一个范围。', options: ['还没确定'] },
  { key: 'timeline', field: 'timeline', label: '装修时间', text: '你希望什么时候开始装修？', options: ['3个月内', '半年内', '还没确定'] },
] as const;
export const version2DefaultGuidance: Guidance = {
  ...legacyDefaultGuidance, schemaVersion: 2,
  questions: questionDefinitions.map(q => ({ key: q.key, field: q.field, text: q.text, options: [...q.options] })),
};
export const roomQuestionDefinitions = [
  { key: 'room', field: 'room', label: '房间', text: '这些空间想法是用于哪个房间？', options: ['书房', '客厅', '卧室', '还没确定'] },
  { key: 'space', field: 'space', label: '空间偏好', text: '这个房间的位置或布局，你有什么偏好？', options: ['靠窗', '安静一些', '还没确定'] },
  { key: 'usage', field: 'usage', label: '使用方式', text: '这个房间主要怎么使用？', options: ['一个人办公', '两人一起办公', '阅读休息', '还没确定'] },
  { key: 'frequency', field: 'frequency', label: '使用频率', text: '这样的使用大概多频繁？', options: ['偶尔周末', '每周几天', '几乎每天', '还没确定'] },
  { key: 'devices', field: 'devices', label: '设备需求', text: '会用哪些设备？可以多选，确认后再发送。', options: ['电脑', '台灯', '显示器', '打印机', '手机充电', '暂时没有'] },
] as const;
export const defaultGuidance: Guidance = {
  ...legacyDefaultGuidance, schemaVersion: 3,
  opening: '你好，我是小K。先聊聊你家的想法，没确定的可以留空。几轮后就能先整理摘要，也可以随时提问。',
  questions: [...questionDefinitions, ...roomQuestionDefinitions].map(q => ({ key: q.key, field: q.field, text: q.text, options: [...q.options], answerType: q.key === 'devices' ? 'multiple' : 'single', skippable: true })),
};
