const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { SpeechController } = require('../packages/assistant/lib/speech');
const api = require('../utils/api');
const turn = () => new Promise(resolve => setImmediate(resolve));
const originalDownload = api.downloadFile;
let current;
function setup({ available = true, cancel = false, failUpload = false } = {}) {
  let token = 'session-a', draft = '', asset = null, stopCallback, errorCallback;
  const requests = [], events = [], storage = new Map(), manager = {
    onStop(fn) { stopCallback = fn; }, offStop(fn) { if (stopCallback === fn) stopCallback = null; },
    onError(fn) { errorCallback = fn; }, offError(fn) { if (errorCallback === fn) errorCallback = null; },
    start(options) { events.push({ kind: 'start', options }); }, stop() { events.push({kind:'stop'}); if(stopCallback) stopCallback({tempFilePath:'owned.wav'}); },
  };
  global.getApp = () => ({ globalData:{ token } });
  global.wx = { getStorageSync:key=>storage.get(key), setStorageSync:(k,v)=>storage.set(k,v), removeStorageSync:k=>storage.delete(k),
    showToast:r=>events.push({kind:'toast',title:r.title}), authorize:r=>{events.push({kind:'authorize'});r.success({});},
    getRecorderManager:()=>manager, showModal:r=>r.success({confirm:!cancel,cancel}), showActionSheet:r=>r.success({tapIndex:0}),
    getFileSystemManager:()=>({readFile:r=>r.success({data:'V0FW'}),unlink:r=>events.push({kind:'unlink',file:r.filePath})}),
    createInnerAudioContext:()=>({stop:()=>events.push({kind:'player-stop'}),destroy:()=>events.push({kind:'player-destroy'}),play:()=>events.push({kind:'play'}),onEnded(){},onError(){}}),
  };
  let failed=false;
  const request=async(url,method,body,options)=>{
    requests.push({url,method,body:JSON.parse(JSON.stringify(body)),key:options.headers?.['Idempotency-Key']});
    if(method==='POST'){
      asset={id:'51',version:3,durationMs:1000,sourceHash:'a'.repeat(64),status:'succeeded',runId:'42',own:true,messageId:null,transcript:'希望书房有两个办公位置。'};
      if(failUpload&&!failed){failed=true;throw {errMsg:'synthetic lost response'};}
      return {success:true,data:asset};
    }
    return {success:true,data:{available,items:asset?[asset]:[]}};
  };
  const voice=new SpeechController({identity:()=>token,emit:p=>events.push({kind:'state',...p}),getDraft:()=>draft,setDraft:value=>{draft=value;},reload:async()=>events.push({kind:'reload'}),request});current=voice;
  return {voice,events,requests,manager,get draft(){return draft;},edit:value=>{draft=value;},switchIdentity:()=>{token='session-b';},seed:value=>{asset=value;}};
}
afterEach(()=>{current?.hide();api.downloadFile=originalDownload;delete global.wx;delete global.getApp;});
test('unconfigured voice preserves the approved unavailable feedback without authorization, recording or upload',async()=>{
  const x=setup({available:false});await x.voice.show('/voice');await x.voice.microphone();
  assert.ok(x.events.some(e=>e.title==='语音暂不可用，可以打字或发图'));assert.equal(x.events.filter(e=>e.kind==='authorize'||e.kind==='start').length,0);assert.equal(x.requests.filter(r=>r.method==='POST').length,0);
});
test('standard recording uploads once then populates editable text, never sends a business message; cancel erases owned temporary audio',async()=>{
  const x=setup();await x.voice.show('/voice');await x.voice.microphone();await turn();await turn();
  assert.match(x.draft,/书房/);assert.deepEqual(x.voice.binding(),{id:'51',version:3});x.edit('希望次卧有两个办公位置。');assert.match(x.draft,/次卧/);
  assert.equal(x.requests.filter(r=>r.method==='POST').length,1);assert.ok(x.requests.every(r=>!r.url.includes('/messages')));assert.ok(x.events.some(e=>e.kind==='unlink'&&e.file==='owned.wav'));
  assert.deepEqual(x.events.find(e=>e.kind==='start').options,{duration:60000,sampleRate:16000,numberOfChannels:1,encodeBitRate:48000,format:'wav'});
  x.voice.hide();const y=setup({cancel:true});await y.voice.show('/voice');await y.voice.microphone();await turn();assert.equal(y.requests.filter(r=>r.method==='POST').length,0);assert.equal(y.draft,'');assert.ok(y.events.some(e=>e.kind==='unlink'));
});
test('an unknown upload reuses the original key and audio body; a new recording cannot replace it',async()=>{
  const x=setup({failUpload:true});await x.voice.show('/voice');await x.voice.upload('ORIGINAL_AUDIO');await x.voice.microphone();
  const writes=x.requests.filter(r=>r.method==='POST');assert.equal(writes.length,2);assert.equal(writes[0].key,writes[1].key);assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[1].body.data,'ORIGINAL_AUDIO');assert.equal(x.events.filter(e=>e.kind==='start').length,0);
});
test('reentry restores a pending transcript without dispatch; original playback is authenticated and disposed on hide or identity change',async()=>{
  const x=setup();await x.voice.show('/voice');await x.voice.upload('AUDIO');x.voice.hide();x.edit('');await x.voice.show('/voice');assert.match(x.draft,/书房/);
  const calls=[];api.downloadFile=async(url,options)=>{calls.push({url,options});return{statusCode:200,tempFilePath:'private-playback.wav'};};await x.voice.play('51');assert.equal(calls[0].url,'/voice/51');assert.equal(calls[0].options.suppressUnauthorized,true);
  x.switchIdentity();await x.voice.refresh();assert.equal(x.voice.visible,false);assert.equal(x.voice.binding(),undefined);assert.ok(x.events.some(e=>e.kind==='player-destroy'));assert.ok(x.events.some(e=>e.file==='private-playback.wav'));
});


test('S04 microphone remains callable after page initialization and delegates to the shared recorder', async () => {
  setup(); wx.getWindowInfo = () => ({windowWidth:390,windowHeight:844,statusBarHeight:24});
  let definition; const previousPage = global.Page; global.Page = value => { definition = value; };
  const modulePath = require.resolve('../packages/construction/chat/chat'); delete require.cache[modulePath];
  let page;
  try {
    require(modulePath); page = {...definition,data:{...definition.data},setData(patch){Object.assign(this.data,patch);}};
    page.onLoad({projectId:'22'}); let calls = 0; page.data.write = true;
    page.speechController.microphone = async () => { ++calls; }; await page.voice();
    assert.equal(calls,1); assert.equal(typeof page.voice,'function');
    page.data.write = false; await page.voice(); assert.equal(calls,1);
  } finally { page?.onHide(); delete require.cache[modulePath]; global.Page = previousPage; }
});
