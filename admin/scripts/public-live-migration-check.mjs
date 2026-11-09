import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';
const output=path.resolve('../tmp/public-live-package/migration-canonical01');fs.mkdirSync(output,{recursive:true});
const rootUrl='postgresql://sfp_owner:sfp_public_live_local_only@127.0.0.1:55434/postgres';
const pool=new pg.Pool({connectionString:rootUrl,max:1});
try{
  const db='sfp_public_live_migration_eval';
  assert.equal((await pool.query('select 1 from pg_database where datname=$1',[db])).rowCount,0,'Preserve prior migration outcomes');
  await pool.query('CREATE DATABASE sfp_public_live_migration_eval OWNER sfp_owner');
  const target='postgresql://sfp_owner:sfp_public_live_local_only@127.0.0.1:55434/'+db;
  const p=new pg.Pool({connectionString:target,max:1});
  await p.query('CREATE SCHEMA app AUTHORIZATION sfp_migrator; GRANT USAGE ON SCHEMA app TO sfp_app,sfp_auditor; CREATE EXTENSION vector; CREATE EXTENSION btree_gist;');await p.end();
  const before=crypto.createHash('sha256').update(fs.readFileSync('drizzle/meta/_journal.json')).digest('hex');
  const binding=Object.fromEntries(JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8')).entries.map(e=>['drizzle/'+e.tag+'.sql',crypto.createHash('sha256').update(fs.readFileSync('drizzle/'+e.tag+'.sql')).digest('hex')]));
  const result=spawnSync(process.execPath,['scripts/postgres-migrate.mjs'],{env:{...process.env,DATABASE_MIGRATION_URL:target},encoding:'utf8',timeout:120000,windowsHide:true});
  fs.writeFileSync(path.join(output,'migration.log'),(result.stdout||'')+(result.stderr||''));assert.equal(result.status,0);
  const client=new pg.Pool({connectionString:target,max:1});
  const tables=(await client.query("select relname,relforcerowsecurity from pg_class where relname like 'construction_public_live%' and relkind='r' order by relname")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(r=>r.relforcerowsecurity));
  const guards=(await client.query("select tgname from pg_trigger where tgname like 'public_live_%' and not tgisinternal order by tgname")).rows;
  assert.equal(guards.length,12);
  const after=crypto.createHash('sha256').update(fs.readFileSync('drizzle/meta/_journal.json')).digest('hex');assert.equal(after,before);
  for(const [file,expected]of Object.entries(binding))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file+' drifted');
  await client.end();
  const report={passed:true,database:db,port:55434,method:'Existing canonical postgres-migrate.mjs and journal, new disposable database on owned instance',tables,guards,journalHash:before,
    migrationHash:crypto.createHash('sha256').update(fs.readFileSync('drizzle/0114_construction_public_live.sql')).digest('hex'),binding,sharedDatabaseTouched:false};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,tables:tables.length,guards:guards.length}));
}finally{await pool.end();}
