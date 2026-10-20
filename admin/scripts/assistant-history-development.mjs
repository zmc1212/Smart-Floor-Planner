import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';

// Environment must be loaded before any JWT module is imported in the child.
const root=path.resolve(import.meta.dirname,'..');
nextEnv.loadEnvConfig(root,true);
const child=spawn(process.execPath,['--import','tsx','scripts/assistant-history-development.ts',...process.argv.slice(2)],
  {cwd:root,env:process.env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
