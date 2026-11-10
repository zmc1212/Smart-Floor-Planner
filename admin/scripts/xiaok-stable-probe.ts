/** Read-only probe: is the Stable automator runtime answering after the manual compile click? */
import path from 'node:path';
import { wechatideNativeClient } from './wechatide-native-client';

const project = path.resolve('..', 'miniprogram');
const client = wechatideNativeClient(project, path.resolve('..', 'tmp/xiaok-v101-native-20261110', 'probe'));

(async () => {
  const info = await client.systemInfo();
  const page = await client.call('automation_runtime_info', { project, action: 'currentPage' });
  console.log(JSON.stringify({ ok: true, width: info.windowWidth, height: info.windowHeight, sdk: info.SDKVersion, page }));
  await client.disconnect().catch(() => {});
})().catch(async (e: Error) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
});
