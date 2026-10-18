import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import nextEnv from '@next/env';
import pg from 'pg';
const root=path.resolve(import.meta.dirname,'..');nextEnv.loadEnvConfig(root,true);
const output=path.resolve(root,'../tmp/xiaok-kb4');fs.mkdirSync(output,{recursive:true});
const isolated=JSON.parse(fs.readFileSync(path.join(root,'../tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
const tag='0087_assistant_knowledge_operations',file=path.join(root,'drizzle',tag+'.sql');
const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const journal=JSON.parse(fs.readFileSync(path.join(root,'drizzle/meta/_journal.json'),'utf8')).entries;
const report={started:new Date().toISOString(),migration:tag,hash,checks:[],backup:null};
const targets=[['development',process.env.DATABASE_MIGRATION_URL,process.env.DATABASE_URL,'5432','/smart_floor_planner'],['evaluation',isolated.EMBEDDING_EVAL_OWNER_URL,isolated.DATABASE_URL,'55432','/xiaok_embedding_eval']];
for(const[,owner,app,port,database]of targets)for(const value of [owner,app]){const u=new URL(value);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!==port||u.pathname!==database)throw Error('Unapproved database target');}
try{
  if(process.argv.includes('--apply')){
    const ssh=['-i','C:/Users/Administrator/.ssh/toonflow_remote_ed25519','-p','22','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','Administrator@192.168.10.54'];
    const remote=(command,input)=>execFileSync('ssh.exe',[...ssh,command],{input,windowsHide:true,maxBuffer:60000000,timeout:60000});
    const image=remote('docker inspect sfp-remote-dev-postgres --format={{.Config.Image}}').toString().trim();if(!image.startsWith('pgvector/pgvector:0.8.2-pg17@sha256:'))throw Error('Unexpected development container');
    if(remote('docker port sfp-remote-dev-postgres').toString().trim()!=='5432/tcp -> 127.0.0.1:15432')throw Error('Unexpected container binding');
    const backup=path.join(output,'development-before-0087.dump');
    const dump=fs.existsSync(backup)?fs.readFileSync(backup):remote('docker exec sfp-remote-dev-postgres pg_dump -U sfp_owner -d smart_floor_planner -Fc');
    if(dump.subarray(0,5).toString()!=='PGDMP')throw Error('Invalid backup signature');
    const listing=remote('docker exec -i sfp-remote-dev-postgres pg_restore --list',dump).toString();if(!listing.includes('assistant_knowledge_versions'))throw Error('Invalid backup archive');
    if(!fs.existsSync(backup))fs.writeFileSync(backup,dump,{flag:'wx'});
    fs.writeFileSync(path.join(output,'backup-directory.txt'),listing);
    report.backup={path:backup,bytes:dump.length,sha256:crypto.createHash('sha256').update(dump).digest('hex'),archiveVerified:true,fullRestoreDrill:false};
    for(const [target,url]of targets){const pool=new pg.Pool({connectionString:url,max:1});try{
      const result=await pool.query('select hash,created_at::text from app.__drizzle_migrations order by created_at desc limit 1');
      if(result.rows[0]?.hash===hash)continue;
      const prior=journal.find(e=>e.idx===86);if(result.rows[0]?.created_at!==String(prior.when))throw Error('Unexpected migration head: '+target);
    }finally{await pool.end();}
      const child=spawnSync(process.execPath,['scripts/postgres-migrate.mjs'],{cwd:root,env:{...process.env,DATABASE_MIGRATION_URL:url},windowsHide:true,encoding:'utf8',timeout:120000});
      fs.writeFileSync(path.join(output,'migration-'+target+'.log'),(child.stdout||'')+(child.stderr||''));if(child.status!==0)throw Error('Migration failed: '+target);
    }
  }
  for(const [target,,url]of targets){const pool=new pg.Pool({connectionString:url,max:1});try{
    if((await pool.query('select id from app.__drizzle_migrations where hash=$1',[hash])).rowCount!==1)throw Error('Migration hash mismatch: '+target);
    const role=(await pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];if(role.rolsuper||role.rolbypassrls)throw Error('Application bypasses RLS');
    const rls=(await pool.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where oid in ('app.assistant_knowledge_cases'::regclass,'app.assistant_knowledge_evaluations'::regclass)")).rows;
    if(rls.length!==2||rls.some(r=>!r.relrowsecurity||!r.relforcerowsecurity))throw Error('Missing forced RLS');
    report.checks.push({target,hash,applicationNonBypass:true,forcedRls:rls.map(r=>r.relname)});
  }finally{await pool.end();}}
  console.log(JSON.stringify({migration:tag,checks:report.checks,backup:report.backup}));
}catch(e){report.error=e.message;console.error(e.message);process.exitCode=1;}
finally{report.finished=new Date().toISOString();fs.writeFileSync(path.join(output,process.argv.includes('--apply')?'migration.json':'migration-check.json'),JSON.stringify(report,null,2));}
