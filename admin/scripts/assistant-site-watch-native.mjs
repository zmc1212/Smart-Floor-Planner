import path from 'node:path';
import { spawn } from 'node:child_process';
import { freezeD4RuntimeConfig } from './assistant-d4-runtime-config.mjs';
const admin = path.resolve(import.meta.dirname, '..'), name = process.argv[2];
if (!/^d4-watch-native-[a-z0-9-]+$/.test(name)) throw Error('Expected labelled native evidence directory');
const config = path.resolve(admin, '../tmp/d4-native-runtime-configs', name + '.json');
freezeD4RuntimeConfig(admin, config);
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/assistant-site-watch-native.ts', name], { cwd: admin,
  env: { ...process.env, TSX_TSCONFIG_PATH: config }, windowsHide: true, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('close', code => { process.exitCode = code ?? 1; });
