import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodePublicPage,extractWebPage,searchWeb} from '../agent/web';

const gbkText=Buffer.from('c7bdc3e6b5f4b7dba3accfc8b4a6c0edbbf9b2e3a1a3','hex');
const text='墙面掉粉，先处理基层。';
const page=(head:string)=>Buffer.concat([Buffer.from('<html><head>'+head+'<title>'),gbkText,Buffer.from('</title></head><body><main>'),...Array.from({length:8},()=>gbkText),Buffer.from('</main></body></html>')]);

test('legacy Chinese meta declarations preserve the real title, conditions and hashed original',()=>{
  const bytes=page('<meta http-equiv="Content-Type" content="text/html; charset=gb2312">');
  assert.notEqual(bytes.toString('utf8'),decodePublicPage(bytes,'text/html'));
  const body=decodePublicPage(bytes,'text/html');
  const parsed=extractWebPage({url:'https://manufacturer.example/preparation',body,type:'text/html'},'2026-11-06T00:00:00Z');
  assert.equal(parsed.title,text);assert.equal(parsed.text,text.repeat(8));assert.doesNotMatch(body,/\uFFFD/);
  assert.equal(parsed.hash,extractWebPage({url:parsed.url,body:new TextDecoder('gbk').decode(bytes),type:'text/html'},parsed.retrievedAt).hash);
});

test('HTTP charset overrides meta and BOM overrides HTTP, including quoted header values',()=>{
  assert.match(decodePublicPage(page('<meta charset="utf-8">'),'text/html; charset="gb2312"'),/墙面掉粉/);
  const unicode=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('<meta charset="gb2312">'+text)]);
  assert.equal(decodePublicPage(unicode,'text/html; charset=gbk'),'<meta charset="gb2312">'+text);
});

test('undeclared pages keep UTF-8 and plain text does not interpret an HTML meta example',()=>{
  assert.equal(decodePublicPage(Buffer.from(text),'text/plain'),text);
  const literal='<meta charset="gb2312">'+text;
  assert.equal(decodePublicPage(Buffer.from(literal),'text/plain'),literal);
  assert.equal(decodePublicPage(Buffer.from('<main>'+text+'</main>'),'text/html'),'<main>'+text+'</main>');
});

test('commented declarations do not override the actual HTML encoding',()=>{
  const bytes=page('<!-- <meta charset="utf-8"> --><meta charset="gbk">');
  assert.match(decodePublicPage(bytes,'text/html'),/墙面掉粉/);
});

test('undecodable original bytes produce the existing read-failure receipt, never replacement-character evidence',async()=>{
  const url='https://manufacturer.example/bad';
  const snapshot=await searchWeb({query:'公开墙面处理说明',domains:[]},{name:'encoding-fixture',search:async()=>[{url,title:'not evidence'}]},async()=>({url,body:decodePublicPage(Buffer.from([0xc3,0x28]),'text/html'),type:'text/html'}));
  assert.equal(snapshot.status,'unavailable');assert.deepEqual(snapshot.pages,[]);
  assert.deepEqual(snapshot.failures,[{url,code:'web_text_unavailable'}]);
});
