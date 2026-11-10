import { loadEnvConfig } from '@next/env';
import { nativeFinalMessages } from '@/lib/assistant/agent/native-final';
loadEnvConfig(process.cwd(), true);
const raw = JSON.stringify({ kind: 'report_answer', answers: { Q1: [{ basis: 'uncertainty', text: '截至2026-11-09 23:25:00。', citations: [] }] } });
const messages = [
  { role: 'system' as const, content: [{ type: 'text' as const, text: '系统提示' }] },
  { role: 'user' as const, content: [{ type: 'text' as const, text: '客户问题' }] },
  { role: 'assistant' as const, content: raw },
  { role: 'system' as const, content: [{ type: 'text' as const, text: '修复反馈：日期时刻须由本段引用支持' }] },
  { role: 'system' as const, content: [{ type: 'text' as const, text: '最终校验修复绑定：{"protocol":"final-answer-repair-v2"}' }] },
];
const projected = nativeFinalMessages(messages);
console.log(JSON.stringify(projected, null, 1).slice(0, 1600));
