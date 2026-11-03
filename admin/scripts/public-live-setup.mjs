/** Explicit new local test instance only. Does not migrate any retained DB. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import assert from 'node:assert/strict';
const target=new URL(process.env.DATABASE_MIGRATION_URL||'');
assert.ok(process.argv.includes('--development')&&process.argv.includes('--isolated')&&['127.0.0.1','localhost'].includes(target.hostname)&&target.port==='55434'&&target.pathname==='/sfp_public_live_eval');
const file='drizzle/0114_construction_public_live.sql',source=fs.readFileSync(file,'utf8'),pool=new pg.Pool({connectionString:target.href,max:1});
const client=await pool.connect();
try{
  assert.equal((await client.query("select to_regclass('app.construction_public_live') as t")).rows[0].t,null,'Preserve prior migration; use a fresh explicit test instance for changed SQL');
  await client.query('begin');await client.query(source);await client.query('commit');
  const tables=(await client.query("select relname,relforcerowsecurity from pg_class where relname like 'construction_public_live%' and relkind='r' order by relname")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(t=>t.relforcerowsecurity));
  const evidence={at:new Date().toISOString(),database:'sfp_public_live_eval',port:55434,migration:file,sha256:crypto.createHash('sha256').update(source).digest('hex'),tables,
    primaryMigration:false,sharedCameraDbTouched:false,journal:'Preserved frozen camera binding; new SQL is explicit development migration pending canonical journal integration'};
  fs.mkdirSync('../tmp/public-live-package',{recursive:true});fs.writeFileSync('../tmp/public-live-package/migration.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}catch(e){await client.query('rollback').catch(()=>{});throw e;}finally{client.release();await pool.end();}
