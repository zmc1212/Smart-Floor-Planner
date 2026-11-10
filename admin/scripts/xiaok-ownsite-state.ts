import fs from 'node:fs';
import path from 'node:path';
import { wechatideNativeClient } from './wechatide-native-client';

const root = path.resolve('..');
const project = path.join(root, 'miniprogram');
const out = path.join(root, 'tmp', 'xiaok-ownsite-fix-20261110', 'client-state');
fs.mkdirSync(out, { recursive: true });
const mp = wechatideNativeClient(project, out);
async function main() {
  const r = await mp.call('automation_evaluate', { project, args: [], fnSource: `() => {
    const p = getCurrentPages().at(-1); if (!p) return { route: null };
    const d = p.data;
    return { route: p.route, loading: !!d.loading, needsLogin: !!d.needsLogin, error: d.error || '',
      followupActive: !!d.followupActive,
      bindings: (d.followupBindings || []).map(b => String(b.bindingId)),
      reports: (d.followupReports || []).map(r => ({ id: String(r.reportId), kind: r.kind, ready: !!r.ready, available: r.available !== false })),
      reportQuestion: d.reportQuestion || null,
      chat: d.followupChat ? { count: (d.followupChat.messages || []).length, generating: !!d.followupChat.generating, busy: !!d.followupChat.busy } : null };
  }` });
  console.log(JSON.stringify(r.result.result, null, 1));
  await mp.screenshot({ path: path.join(out, 'state.png') });
}
main().finally(() => mp.disconnect().catch(() => {}));
