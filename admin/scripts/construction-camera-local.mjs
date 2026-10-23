// Isolated local runtime: no production database, no mutation of the active 3006 server.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const cfg = JSON.parse(fs.readFileSync(path.join(root, '../tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
const db = new URL(cfg.DATABASE_URL);
if (!['127.0.0.1','localhost'].includes(db.hostname) || db.port !== '55432') throw Error('Isolated local database required');
db.pathname = '/cloud_camera_eval';
const vendorPath = process.env.CAMERA_LOCAL_WVP_ENV;
if (!vendorPath) throw Error('CAMERA_LOCAL_WVP_ENV must identify the authorized local WVP .env');
const vendor = Object.fromEntries(fs.readFileSync(vendorPath,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const env = { ...process.env, NODE_ENV:'development', DATABASE_URL:db.toString(), NEXT_DIST_DIR:'.next-camera', CAMERA_PUBLIC_ORIGIN:'http://localhost:3017', CAMERA_APP_ORIGIN:'http://127.0.0.1:3018', CAMERA_WVP_ORIGIN:'http://127.0.0.1:18080', CAMERA_MEDIA_ORIGIN:`http://127.0.0.1:${vendor.MEDIA_HTTP_PORT || '8080'}`, CAMERA_WVP_USERNAME:'admin', CAMERA_WVP_PASSWORD:vendor.WVP_ADMIN_PASSWORD };
const args = process.argv.includes('--gateway') ? ['--import','tsx','scripts/construction-camera-gateway.ts'] : process.argv.includes('--fixture') ? ['--import','tsx','scripts/construction-camera-fixture.ts'] : ['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3018'];
const child = spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code ?? 1;});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
