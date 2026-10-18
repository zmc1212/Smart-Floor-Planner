import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';
const root=path.resolve(import.meta.dirname,'..');nextEnv.loadEnvConfig(root,true);
const isolated=JSON.parse(fs.readFileSync(path.join(root,'../tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'drizzle/0085_assistant_professional_knowledge.sql'))).digest('hex');
for(const [target,connectionString,database,port] of [['development',process.env.DATABASE_URL,'/smart_floor_planner','5432'],['evaluation',isolated.DATABASE_URL,'/xiaok_embedding_eval','55432']]) {
  const url=new URL(connectionString);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!==database||url.port!==port)throw Error('Unapproved database target');
  const pool=new pg.Pool({connectionString,max:1});
  try {
    if((await pool.query('select id from app.__drizzle_migrations where hash=$1',[hash])).rowCount!==1)throw Error('KB-1 migration hash mismatch');
    if((await pool.query("select 1 from information_schema.columns where table_schema='app' and table_name='assistant_knowledge_versions' and column_name='professional'")).rowCount!==1)throw Error('Missing professional field');
    const role=(await pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];if(role.rolsuper||role.rolbypassrls)throw Error('Application role bypasses RLS');
    const rls=(await pool.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app.assistant_knowledge_versions'::regclass")).rows[0];if(!rls.relrowsecurity||!rls.relforcerowsecurity)throw Error('Missing forced RLS');
    console.log(JSON.stringify({target,migration:'0085_assistant_professional_knowledge',hash,forcedRls:true,applicationNonBypass:true}));
  }finally{await pool.end();}
}
