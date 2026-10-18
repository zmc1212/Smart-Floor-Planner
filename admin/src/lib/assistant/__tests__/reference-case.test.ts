import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { prepareReferenceCase, referenceCase, referenceContent } from '../knowledge/reference-case';
import { explicitReferencePreference } from '../knowledge/reference-service';
import { applyNeedDelta } from '../agent/memory';

test('licensed reference requires a source, rights evidence and independent JPEG/PNG, normalized under 300KB', async () => {
  const png = await sharp({create:{width:1600,height:800,channels:3,background:'#9cba91'}}).png().toBuffer();
  const ref = await prepareReferenceCase({source:'自制测试图',authorization:'测试作者授权，仅隔离测试',tags:['收纳'],imageBase64:png.toString('base64')});
  const meta = await sharp(Buffer.from(ref.imageBase64,'base64')).metadata();
  assert.equal(meta.format,'jpeg'); assert.equal(meta.width,1200); assert.ok(Buffer.from(ref.imageBase64,'base64').length<=300*1024);
  assert.throws(()=>referenceCase({...ref,authorization:''}),/invalid_reference_case/);
  assert.throws(()=>referenceContent('a'.repeat(401),ref),/invalid_reference_case/);
  assert.notEqual(referenceContent('原木收纳方向。',ref).hash, referenceContent('原木收纳方向。',{...ref,authorization:'另一授权凭据'}).hash);
  await assert.rejects(prepareReferenceCase({...ref,imageBase64:Buffer.from('<svg/>').toString('base64')}),/invalid_reference_case/);
});
test('only explicit likes/dislikes are preferences; browsing, hypothetical and negative likes never become approval', () => {
  for (const text of ['先看看第一个','第一个喜欢吗？','如果喜欢第一个呢','浏览不代表喜欢','“喜欢第一个”是你说的']) assert.equal(explicitReferencePreference(text,text,'like'),false);
  assert.equal(explicitReferencePreference('第一个不喜欢','第一个不喜欢','like'),false);
  assert.equal(explicitReferencePreference('第一个不喜欢','喜欢','like'),false);
  assert.equal(explicitReferencePreference('第一个不太满意','第一个不太满意','dislike'),true);
  assert.equal(explicitReferencePreference('第一个不喜欢','第一个不喜欢','dislike'),true);
  assert.equal(explicitReferencePreference('第一个喜欢','第一个喜欢','like'),true);
  assert.equal(explicitReferencePreference('第一个喜欢','我最喜欢','like'),false);
});
test('model cannot turn a reference-browsing clause into a saved need',()=>{
  assert.throws(()=>applyNeedDelta({version:0,facts:[]},{room:'',field:'style',value:'原木',quote:'给我看看原木参考案例',sourceMessageId:'1',expectedVersion:0},
    {id:'1',text:'给我看看原木参考案例'},'op','2026-10-16'),/need_source_mismatch/);
});
