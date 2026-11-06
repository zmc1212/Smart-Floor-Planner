import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {publicDiscoveryQuery,searchPublicResearch,publicReaderParser,publicDocumentPages,type PublicReadDocument} from '../agent/public-research';

const query={query:'厂家官网 旧墙翻新',domains:['paint.example.com']};
const candidate={url:'https://paint.example.com/product/base',title:'厂家涂料施工说明'};
test('an unverified domain is only a recorded discovery hint; scoped results keep their original topical query',async()=>{
  const discovery=publicDiscoveryQuery(query,'旧墙掉粉能直接重涂吗？',[],true);
  assert.deepEqual(discovery.query.domains,[]);assert.deepEqual(discovery.searchHint,query);
  const calls:unknown[]=[];
  const snapshot=await searchPublicResearch(discovery.query,{name:'fixture',search:async input=>{calls.push(input);return[candidate];}},undefined,undefined,Infinity,
    {runId:'888',sequence:1200,discoverOnly:true,explicitSelection:true,searchHint:discovery.searchHint});
  assert.equal(calls.length,2);assert.deepEqual(calls[0],query);assert.equal(snapshot.pages.length,0);
  assert.equal(snapshot.candidates?.[0].url,candidate.url);assert.deepEqual(snapshot.research?.queries?.[0],query);
  assert.deepEqual(snapshot.research?.queries?.[1].domains,[]);
  assert.deepEqual(snapshot.query,discovery.query);
});

test('an empty or engine-ignored domain hint falls back to actual directory discovery without trusting the hint',async()=>{
  const discovery=publicDiscoveryQuery(query,'帮我看看厂家官网的说明。',[],true),calls:unknown[]=[];
  const snapshot=await searchPublicResearch(discovery.query,{name:'fixture',search:async input=>{calls.push(input);return calls.length===1?[{url:'https://other.example.com/',title:'Unrelated'}]:[candidate];}},undefined,undefined,Infinity,
    {runId:'888',sequence:1200,discoverOnly:true,explicitSelection:true,searchHint:discovery.searchHint});
  assert.equal(calls.length,2);assert.deepEqual(snapshot.research?.queries.at(-1)?.domains,[]);
  assert.ok(snapshot.candidates?.some(c=>c.url===candidate.url));assert.equal(snapshot.pages.length,0);
});

test('a failed or crowded wrong-domain hint cannot erase actual broader discovery',async()=>{
  for(const failed of [true,false]){
    const discovery=publicDiscoveryQuery(query,'查下厂家官网。',[],true);let calls=0;
    const snapshot=await searchPublicResearch(discovery.query,{name:'fixture',search:async input=>{
      if(calls++===0){if(failed)throw new Error('actual search unavailable');return Array.from({length:8},(_,i)=>({url:`https://paint.example.com/advert${i}`,title:'经销商广告'}));}
      assert.deepEqual(input.domains,[]);return[{url:'https://actual-manufacturer.example/technical',title:'厂家真实技术原文'}];
    }},undefined,undefined,Infinity,{runId:'888',sequence:1200,discoverOnly:true,explicitSelection:true,searchHint:discovery.searchHint});
    assert.equal(calls,2);assert.ok(snapshot.candidates?.some(c=>c.url==='https://actual-manufacturer.example/technical'));
    assert.ok(snapshot.candidates!.length<=8);assert.equal(snapshot.pages.length,0);
    if(failed)assert.deepEqual(snapshot.failures,[{code:'web_search_unavailable'}]);
  }
});

test('ordinary read_web fetches only the selected original; alternatives and anchors remain unread candidates',async()=>{
  const bytes=Buffer.from('<html><main>旧墙面施工前应清除疏松的涂层并检查基层；潮湿时不宜直接施工。</main></html>');
  const original:PublicReadDocument={version:1,url:candidate.url,title:candidate.title,parser:publicReaderParser,mediaType:'text/html',pages:[{page:1,text:'旧墙面施工前应清除疏松的涂层并检查基层，保持基面清洁；潮湿条件下不宜直接施工，以免影响附着。'}],links:[{url:'https://paint.example.com/industrial',title:'工业涂料'}],redirects:[],original:{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,base64:bytes.toString('base64')},egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true};
  const selected={...candidate,id:'P888:1200:0',parent:null,depth:0},calls:string[]=[];
  const result=await searchPublicResearch({query:'旧墙翻新',domains:[]},null,async url=>{calls.push(url);return original;},undefined,Infinity,
    {runId:'888',sequence:1210,explicitSelection:true,selected,alternatives:[selected,{...selected,id:'P888:1200:1',url:'https://paint.example.com/advert'}]});
  assert.deepEqual(calls,[candidate.url]);assert.equal(result.research?.reads,1);assert.equal(result.pages.length,1);
  assert.ok(result.candidates?.some(c=>c.url===original.links[0].url));assert.equal(result.documents?.length,1);
});

test('private and special-use domain hints never become a public search scope',()=>{
  for(const domain of ['localhost.local','127.0.0.1','secret.internal'])
    assert.throws(()=>publicDiscoveryQuery({...query,domains:[domain]},'查下公开资料。',[],true),{code:'unsafe_web_url'});
});

test('a complete selected original fits the existing18KB total without the legacy12KB per-page rejection',async()=>{
  const text='原文条件。'.repeat(900),bytes=Buffer.from(text);
  assert.ok(bytes.length>12000&&bytes.length<18000);
  const original:PublicReadDocument={version:1,url:candidate.url,title:candidate.title,parser:publicReaderParser,mediaType:'text/html',pages:[{page:1,text}],links:[],redirects:[],
    original:{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,base64:bytes.toString('base64')},egress:'upstream-v0.9.2-resolve-and-pin-proxy',tlsVerification:true};
  const selected={...candidate,id:'P888:1200:0',parent:null,depth:0},before=JSON.stringify(original);
  const result=await searchPublicResearch({query:'施工条件',domains:[]},null,async()=>original,undefined,Infinity,{runId:'888',sequence:1210,selected,explicitSelection:true});
  assert.equal(result.pages[0].text,text);assert.equal(result.documents![0].original.sha256,original.original.sha256);assert.equal(JSON.stringify(original),before);
  assert.deepEqual(publicDocumentPages({...original,pages:[{page:1,text:'x'.repeat(18001)}]},new Date().toISOString()),[]);
});
