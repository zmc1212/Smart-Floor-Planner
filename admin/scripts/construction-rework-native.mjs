/** Load secrets before any module-scoped JWT/crypto bindings in the TS driver. */
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
const admin = path.resolve(import.meta.dirname, '..');
nextEnv.loadEnvConfig(admin, true);
const child = spawn(process.execPath, ['--import','tsx','scripts/construction-rework-native.ts',...process.argv.slice(2)],
  { cwd: admin, env: { ...process.env, CONSTRUCTION_REWORK_ENV_READY: '1' }, windowsHide: true, stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
