import fs from 'node:fs';
import path from 'node:path';
import { wechatideNativeClient } from './wechatide-native-client';

const root = path.resolve('..');
const project = path.join(root, 'miniprogram');
const out = path.join(root, 'tmp', 'xiaok-ownsite-fix-20261110', 'cleanup');
fs.mkdirSync(out, { recursive: true });
const mp = wechatideNativeClient(project, out);
const evaluate = async <T>(source: string): Promise<T> => {
  const r = await mp.call('automation_evaluate', { project, fnSource: source, args: [] });
  return r.result.result as T;
};
async function main() {
  const restored = await evaluate<boolean>(`() => { const a = getApp(), s = a.__qaFix; if (!s) return false;
    a.globalData.token = s.token; a.globalData.bootstrap = s.bootstrap; a.globalData.userInfo = s.userInfo; a.hydrateStoredSession = s.hydrate;
    delete a.__qaFix; wx.removeStorageSync('assistant-active-conversation-v1'); return true; }`);
  await mp.reLaunch('/pages/index/index');
  console.log(JSON.stringify({ restored }));
}
main().finally(() => mp.disconnect().catch(() => {}));
