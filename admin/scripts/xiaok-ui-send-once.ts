/** Send one report follow-up through the real Stable composer. */
import path from 'node:path';
import fs from 'node:fs';
import { wechatideNativeClient } from './wechatide-native-client';
const root = path.resolve('..'), project = path.join(root, 'miniprogram');
const output = path.join(root, 'tmp/xiaok-user-journey-20261112/send-once');
fs.mkdirSync(output, { recursive: true });
const cli = wechatideNativeClient(project, output);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  const p = await cli.currentPage();
  if (!p || p.path !== 'packages/assistant/chat/chat') throw new Error('not on chat page');
  const before = await p.data();
  console.log('before', JSON.stringify({ active: before.followupActive, binding: before.followupContext?.bindingId,
    report: before.reportQuestion?.selected?.reportId, disabled: before.reportQuestion?.disabled,
    canCompose: before.followupChat?.canCompose, draft: before.followupChat?.draft }));
  const text = process.argv[2] || '这份日报里写的最近进展是什么？请只按这份报告回答。';
  const draft = await p.$('.followup-human-composer textarea');
  if (!draft) throw new Error('no composer');
  await draft.input(text);
  await delay(800);
  const button = await p.$('.followup-human-composer .send-button');
  if (!button) throw new Error('no send button');
  await button.tap();
  await delay(2000);
  const after = await p.data();
  console.log('after', JSON.stringify({ draft: after.followupChat?.draft, pendingSend: after.followupChat?.pendingSend,
    generating: after.followupChat?.generating, error: after.followupChat?.error }));
  await cli.screenshot({ path: path.join(output, 'send.png') });
})();
