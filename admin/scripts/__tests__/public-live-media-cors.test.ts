import test from 'node:test';
import assert from 'node:assert/strict';
import { OPTIONS } from '../../src/app/api/public/construction-live/[enterpriseId]/[[...path]]/route';
import { liveMediaCorsHeaders } from '../../src/lib/construction/public-live/media-cors';

const key='a'.repeat(48),token='b'.repeat(43),media=[key,'media',token,'hls.m3u8'];
const context=(parts:string[])=>({params:Promise.resolve({enterpriseId:'1454',path:parts})});
const request=(method='GET',headers='Range')=>new Request('http://127.0.0.1:3019/api/public/construction-live/1454/'+media.join('/'),{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:48000','Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers}});

test('a browser HLS Range preflight succeeds without credentials or a media/session read',async()=>{
  const response=await OPTIONS(request(),context(media));
  assert.equal(response.status,204);assert.equal(await response.text(),'');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal(response.headers.get('Access-Control-Allow-Methods'),'GET, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Headers'),'Range');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(liveMediaCorsHeaders['Access-Control-Allow-Origin'],'*');
});

test('CORS preflight cannot authorize a mutation, Authorization header or arbitrary source path',async()=>{
  for(const [method,headers]of [['POST','Range'],['GET','Authorization'],['GET','Range, Idempotency-Key']])assert.equal((await OPTIONS(request(method,headers),context(media))).status,404);
  for(const parts of [[key],[key,'session'],['site','1'],[key,'media','bad','hls.m3u8'],[key,'media',token,'..','private.ts']]){
    const response=await OPTIONS(request(),context(parts));assert.equal(response.status,404);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  }
});
