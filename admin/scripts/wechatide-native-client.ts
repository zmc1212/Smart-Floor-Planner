import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const execFile = promisify(cp.execFile);
const install = 'D:/微信开发工具/微信web开发者工具';
const bootstrap = "const e=process.argv[1],a=process.argv.slice(2);if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,e,'--electron'].concat(a);require(e)";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Documented native automation RPC payloads.

/** Registered Stable CLI tools only, using its existing Codex authorization.
 * No shell interpolation, desktop input, project reopening or token discovery. */
export function wechatideNativeClient(project: string, output: string) {
  const call = async (tool: string, fields: Row = {}): Promise<Row> => {
    const args = ['-c', 'codex', tool];
    const privateFiles: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const flag = key.replace(/[A-Z]/g, x => '-' + x.toLowerCase());
      if (key === 'args') {
        const file = path.join(output, `cli-args-${randomUUID()}.private.json`);
        fs.writeFileSync(file, JSON.stringify(value)); privateFiles.push(file);
        args.push('--args-file', file);
      } else args.push('--' + flag, typeof value === 'string' ? value : JSON.stringify(value));
    }
    try {
      const result = await execFile(path.join(install, '微信开发者工具.exe'), ['-e', bootstrap,
        path.join(install, 'resources/app.asar.unpacked/js/common/cli/skill-index.js'), ...args],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
      if (!payload.ok || payload.result?.success === false) throw Error(`Stable CLI ${tool}: ${JSON.stringify(payload.result || payload.error)}`);
      return payload.result;
    } finally { for (const file of privateFiles) fs.rmSync(file, { force: true }); }
  };
  const evaluate = async (fn: (...args: any[]) => unknown, ...args: unknown[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any -- SDK-compatible callback signature.
    const value = await call('automation_evaluate', { project, fnSource: fn.toString(), args });
    return value.result.result;
  };
  const element = (selector: string) => ({
    tap: () => call('automation_element_action', { project, selector, action: 'tap' }),
    input: (value: string) => call('automation_element_action', { project, selector, action: 'input', value }),
    offset: () => call('automation_element_action', { project, selector, action: 'offset' }),
    size: () => call('automation_element_action', { project, selector, action: 'size' }),
  });
  const currentPage = async () => {
    const info = await call('automation_runtime_info', { project, action: 'currentPage' });
    const current = info.currentPage;
    if (!current) return null;
    return { path: current.path,
      data: async () => (await call('automation_page_action', { project, action: 'getData' })).data,
      $: async (selector: string) => {
        const result = await call('automation_page_action', { project, action: 'querySelectorAll', selector });
        return result.elements?.length ? element(selector) : null;
      } };
  };
  const navigate = (action: string, url: string) => call('automation_navigate', { project, action, url });
  return { call, evaluate, currentPage,
    systemInfo: async () => (await call('automation_runtime_info', { project, action: 'systemInfo' })).systemInfo.result,
    pageStack: async () => (await call('automation_runtime_info', { project, action: 'pageStack' })).pageStack,
    redirectTo: (url: string) => navigate('redirectTo', url), reLaunch: (url: string) => navigate('reLaunch', url),
    pageScrollTo: (scrollTop: number) => call('automation_viewport_action', { project, action: 'pageScrollTo', scrollTop }),
    screenshot: ({ path: file }: { path: string }) => call('simulator_screenshot', { project, path: file, optimize: false }),
    mockWxMethod: (method: string, result: unknown) => call('automation_wx_api', { project, action: 'mock', method, result }),
    restoreWxMethod: (method: string) => call('automation_wx_api', { project, action: 'restore', method }),
    disconnect: async () => {},
  };
}
