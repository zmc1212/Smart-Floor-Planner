import { guardAnswerCommitments } from '@/lib/assistant/agent/context';

const texts = [
  '如需了解最新的工地进展，建议直接联系您的管家或施工人员获取实时状态。',
  '建议直接联系您的管家或施工人员获取实时状态。',
  '根据2026年11月9日23:25截止的原报告记录，项目团队在当天22:48标记的最新施工阶段为“软装”。',
  '在报告统计周期内，现场曾于22:32进入“安装”阶段，随后在22:48转为“软装”阶段。',
  '由于原报告事实已截止，且本期未提供可见的已发布现场记录，无法确认截止后是否有新的施工进度或变化。',
];
for (const text of texts) {
  try { guardAnswerCommitments(text); console.log('OK  ', text); }
  catch (e) { console.log('FAIL', (e as Error).message, '|', text); }
}
