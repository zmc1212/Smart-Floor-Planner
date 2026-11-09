// Isolated local runtime: no production database, no mutation of the active 3006 server.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
import { cameraLocalConfig } from './construction-camera-local-config.mjs';
const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const cfg = JSON.parse(fs.readFileSync(path.join(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const vendorPath = process.env.CAMERA_LOCAL_WVP_ENV;
if (!vendorPath) throw Error('CAMERA_LOCAL_WVP_ENV must identify the authorized local WVP .env');
const vendor = Object.fromEntries(fs.readFileSync(vendorPath,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const local = cameraLocalConfig(cfg.DATABASE_URL, vendor, process.env);
const env = { ...process.env, NODE_ENV:'development', ...local.env };
const building=process.argv.includes('--build-check');if(building){env.NODE_ENV='production';env.NEXT_DIST_DIR='.next-camera-build';}
env.CAMERA_ZLM_SECRET=vendor.ZLM_SECRET;env.CAMERA_MEDIA_SERVER_ID='wvp-zlm-01';env.CAMERA_NODE_RETENTION_DAYS=vendor.RECORD_DAYS||'7';env.CAMERA_RECORDING_ROOT='/opt/media/www/record';
const storageFile=path.join(root,'../tmp/cloud-camera/storage.private.json');
if(fs.existsSync(storageFile)){const storage=JSON.parse(fs.readFileSync(storageFile,'utf8'));env.CAMERA_STORAGE_ORIGIN=process.env.CAMERA_STORAGE_ORIGIN||storage.origin;env.CAMERA_STORAGE_TOKEN=process.env.CAMERA_STORAGE_TOKEN||storage.token;}
const args = process.argv.includes('--gateway') ? ['--import','tsx','scripts/construction-camera-gateway.ts'] : process.argv.includes('--fixture') ? ['--import','tsx','scripts/construction-camera-fixture.ts'] : process.argv.includes('--recording-check')?['--import','tsx','scripts/construction-camera-recording-live.ts']:['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p',local.appPort];
if(process.argv.includes('--retention-check'))args.splice(0,args.length,'--import','tsx','scripts/construction-camera-retention-live.ts');
if(process.argv.includes('--recovery-check'))args.splice(0,args.length,'--import','tsx','scripts/construction-camera-recovery-live.ts');
if(process.argv.includes('--storage-check')){args.splice(0,args.length,'--import','tsx','scripts/construction-camera-storage-live.ts');if(process.argv.includes('--ui-hold'))args.push('--ui-hold');}
if(process.argv.includes('--soak-check')){args.splice(0,args.length,'--import','tsx','scripts/construction-camera-soak.ts');for(const flag of ['--smoke','--preflight','--cleanup-recovery-check'])if(process.argv.includes(flag))args.push(flag);}
if(process.argv.includes('--soak-control')){args.splice(0,args.length,'--import','tsx','scripts/construction-camera-soak-control.ts');for(const flag of ['--request-stop','--cleanup-orphan'])if(process.argv.includes(flag))args.push(flag);}
if(building)args.splice(0,args.length,'node_modules/next/dist/bin/next','build','--webpack');
if(process.argv.includes('--playback-only')&&process.argv.includes('--recording-check'))args.push('--playback-only');
if(process.argv.includes('--background')){
 if(!process.argv.includes('--soak-check')||process.argv.includes('--smoke')||process.argv.includes('--preflight'))throw Error('Only the full bounded soak supports background mode');
 const out=process.env.CAMERA_TEST_OUTPUT?path.resolve(process.env.CAMERA_TEST_OUTPUT):path.join(root,'../tmp/cloud-camera'),log=path.join(out,'soak-process-'+new Date().toISOString().replace(/[:.]/g,'-')+'.log');fs.mkdirSync(out,{recursive:true});const fd=fs.openSync(log,'a');
 const background=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});background.unref();fs.closeSync(fd);console.log(JSON.stringify({pid:background.pid,log}));process.exit(0);
}
const child = spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:building?['ignore','pipe','pipe']:'inherit'});
if(building){let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('exit',code=>{const out=path.join(root,'../tmp/cloud-camera');fs.mkdirSync(out,{recursive:true});const file=path.join(out,'build-'+new Date().toISOString().replace(/[:.]/g,'-')+'.log');fs.writeFileSync(file,log);console.log(JSON.stringify({buildExit:code,compiled:/Compiled successfully/.test(log),tail:log.split('\n').filter(l=>/error|Type error|Failed|invalid|AiDesignerLegacyPage|\.tsx?:/.test(l)).slice(-10),evidence:file}));});}
child.on('exit',code=>{process.exitCode=code ?? 1;});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
