import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePilot} from './prepare.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfp-pilot-prepare-'));
  t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'sfp-pilot-prepare-'));fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}
const read=dir=>JSON.parse(fs.readFileSync(path.join(dir,'instance.private.json'),'utf8'));

test('repeated preparation preserves encryption, login and business credentials',t=>{
  const dir=fixture(t);preparePilot(dir);const first=read(dir);
  const env=fs.readFileSync(path.join(dir,'instance.env'),'utf8');
  assert.equal(preparePilot(dir).legacySessionsInvalidated,false);
  assert.deepEqual(read(dir),first);assert.equal(fs.readFileSync(path.join(dir,'instance.env'),'utf8'),env);
});
test('legacy setup adopts upstream keys and invalidates only old login sessions once',t=>{
  const dir=fixture(t);const old={password:'local-test-password',jwtSecret:'legacy-jwt',bridgeKey:'local-test-bridge'};
  fs.writeFileSync(path.join(dir,'instance.private.json'),JSON.stringify(old));
  fs.writeFileSync(path.join(dir,'instance.env'),`SIG_KEY="${'a'.repeat(64)}"\nSIG_SALT=${'b'.repeat(64)}\n`);
  assert.equal(preparePilot(dir).legacySessionsInvalidated,true);const upgraded=read(dir);
  assert.equal(upgraded.sigKey,'a'.repeat(64));assert.equal(upgraded.sigSalt,'b'.repeat(64));
  assert.equal(upgraded.password,old.password);assert.equal(upgraded.bridgeKey,old.bridgeKey);assert.notEqual(upgraded.jwtSecret,old.jwtSecret);
  assert.equal(preparePilot(dir).legacySessionsInvalidated,false);assert.deepEqual(read(dir),upgraded);
});
test('missing or partial keys cannot silently replace encrypted database state',t=>{
  const dir=fixture(t);fs.mkdirSync(path.join(dir,'storage'));fs.writeFileSync(path.join(dir,'storage/anythingllm.db'),'synthetic');
  assert.throws(()=>preparePilot(dir),/keys are missing/);assert.equal(fs.existsSync(path.join(dir,'instance.private.json')),false);
  fs.writeFileSync(path.join(dir,'instance.env'),`SIG_KEY=${'a'.repeat(64)}\n`);
  assert.throws(()=>preparePilot(dir),/Incomplete encryption/);assert.equal(fs.existsSync(path.join(dir,'instance.private.json')),false);
});
