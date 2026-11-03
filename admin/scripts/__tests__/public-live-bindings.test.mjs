import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPublicLive,comparePublicLive} from '../public-live-bindings.mjs';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

test('absolute tool paths are checked at their own drive, and changes still invalidate binding',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfp-live-binding-')),file=path.join(dir,'tool.json');
  try{
    fs.writeFileSync(file,'original');
    const before={files:{[file]:digest('original')},config:{}};
    assert.deepEqual(comparePublicLive(before),[]);
    fs.writeFileSync(file,'changed');
    assert.deepEqual(comparePublicLive(before),[file]);
    fs.unlinkSync(file);
    assert.deepEqual(comparePublicLive(before),[file]);
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
});

test('actual binder keeps local source and external file/config guards together',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sfp-live-binding-')),file=path.join(dir,'tool.json');
  const old=process.env.PUBLIC_LIVE_PUBLIC_ORIGIN;
  try{
    fs.writeFileSync(file,'original');
    const before=bindPublicLive([file,'admin/scripts/public-live-bindings.mjs']);
    const external=path.relative(path.resolve('..'),file).replaceAll('\\','/');
    assert.equal(before.files[external],digest('original'));
    assert.ok(before.files['admin/scripts/public-live-bindings.mjs']);
    assert.deepEqual(comparePublicLive(before),[]);
    process.env.PUBLIC_LIVE_PUBLIC_ORIGIN='http://127.0.0.1:1';
    assert.deepEqual(comparePublicLive(before),['config:PUBLIC_LIVE_PUBLIC_ORIGIN']);
  }finally{if(old===undefined)delete process.env.PUBLIC_LIVE_PUBLIC_ORIGIN;else process.env.PUBLIC_LIVE_PUBLIC_ORIGIN=old;fs.unlinkSync(file);fs.rmdirSync(dir);}
});
