const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceImage } = require('../packages/assistant/lib/reference-image');
const { ChatController } = require('../packages/assistant/lib/chat');
const { entryInput } = require('../packages/assistant/lib/client');

test('reference image uses authenticated citation bytes only and removes local files when source closes', async () => {
  const previous=global.wx, removed=[], writes=[];
  global.wx={env:{USER_DATA_PATH:'/private'},getFileSystemManager:()=>({writeFile:args=>{writes.push(args);args.success();},unlink:args=>removed.push(args.filePath)})};
  try{
    const images=new ReferenceImage();
    const citation=await images.materialize({id:'12',available:true,reference:{source:'作者原图',authorization:'CC0',mimeType:'image/jpeg',imageBase64:'/9j/AA=='}});
    assert.equal(citation.reference.imageBase64,undefined);assert.match(citation.imagePath,/^\/private\/assistant-reference-12-/);assert.equal(writes[0].encoding,'base64');
    images.clear();assert.deepEqual(removed,[citation.imagePath]);
    assert.deepEqual(await images.materialize({id:'12',available:false}),{id:'12',available:false});
  }finally{global.wx=previous;}
});
test('closing sheet or changing identity during image writing prevents late private image display', async () => {
  const previous=global.wx, removed=[];let finish;
  global.wx={env:{USER_DATA_PATH:'/private'},getFileSystemManager:()=>({writeFile:args=>{finish=args.success;},unlink:args=>removed.push(args.filePath)})};
  try{const images=new ReferenceImage(),pending=images.materialize({id:'13',available:true,reference:{mimeType:'image/jpeg',imageBase64:'/9j/AA=='}});
    images.clear();finish();await assert.rejects(pending,e=>e.code==='context_changed');assert.equal(removed.length,1);
  }finally{global.wx=previous;}
});
test('chat reference source uses the existing citation state, without selection writes, and fences stale results', async () => {
  const calls=[];let identity='customer-a',resolveImage;
  const controller=new ChatController({emit:()=>{},identity:()=>identity,client:{read:async path=>{calls.push(path);return {id:'7',available:true,reference:{imageBase64:'test'}};}},referenceImage:()=>new Promise(resolve=>{resolveImage=resolve;})});
  controller.session=identity;const pending=controller.openCitation('7');await Promise.resolve();
  identity='customer-b';resolveImage({id:'7',available:true,imagePath:'/private/stale.jpg'});await pending;
  assert.equal(controller.state.citation,null);assert.deepEqual(calls,['/citations/7']);
});
test('shared case is a single explicit chat entry and native forwarding never exports a private conversation', () => {
  assert.deepEqual(entryInput({referenceEntry:'signed-reference'}),{referenceEntry:'signed-reference'});
  assert.throws(()=>entryInput({referenceEntry:'signed-reference',conversationId:'private-id'}));
  const previous=global.Page;let page;
  try{
    global.Page=value=>{page=value;};delete require.cache[require.resolve('../packages/assistant/chat/chat.js')];require('../packages/assistant/chat/chat.js');
    const shared=page.onShareAppMessage.call({data:{shareReferenceEntry:'signed-reference',conversation:{id:'private-id'},mediaPaths:{'1':'private.jpg'}}});
    assert.equal(shared.path,'/packages/assistant/chat/chat?referenceEntry=signed-reference');assert.equal(shared.imageUrl,'/packages/assistant/assets/xiaok-consultation.png');
    assert.equal(page.onShareAppMessage.call({data:{conversation:{id:'private-id'}}}).path,'/pages/index/index');
  }finally{global.Page=previous;}
});
