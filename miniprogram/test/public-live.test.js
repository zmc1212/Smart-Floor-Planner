const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {LiveConsentController}=require('../packages/assistant/lib/public-live');
const card={id:'7',versionId:'8',messageId:'20',revision:3,key:'a'.repeat(48),status:'pending_owner',statusLabel:'待你决定',available:true,canDecide:true,canWithdraw:true,alias:'客厅机位',name:'测试工地'};
const path='/api/public/construction-live/1454/'+card.key+'/media/'+'b'.repeat(43)+'/hls.m3u8';
function env(){const storage=new Map();global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)};return storage;}

test('opening WebView uses the preview receipt and approval only follows server playback readback',async()=>{
  env();let row={...card,playbackReady:false},refreshes=0;const opens=[],writes=[];
  const page=require('../packages/assistant/chat/chat-definition')();
  const c=new LiveConsentController({identity:()=> 'owner',emit(){},openPreview:async(cid,receipt)=>opens.push({cid,receipt}),
    request:async(p,method)=>{
      if(method==='GET')return {success:true,data:{items:[{...row}]}};
      writes.push(p);
      row={...row,revision:row.revision+1,status:p.endsWith('/approve')?'owner_approved':'pending_owner'};
      return {success:true,data:{...row,material:row}};
    }});
  page.liveConsent=c;page.controller={async refresh(){refreshes++;}};
  const action=type=>page.liveDecision({currentTarget:{dataset:{id:'7',action:type}}});
  await c.load('9');await action('approve');assert.equal(writes.length,0);
  await action('preview');
  assert.equal(refreshes,0);assert.equal(opens[0].cid,'9');assert.equal(opens[0].receipt.revision,4);
  await action('approve');assert.equal(writes.length,1);
  c.clear();row.playbackReady=true;await c.load('9');
  await action('approve');assert.equal(refreshes,1);assert.equal(c.card('7').status,'owner_approved');
});

test('owner cover downloads are scoped and previous files are removed on revision or identity changes',async()=>{
  env();let identity='owner',row={...card,cover:{id:'71',capturedAt:'2026-11-04T01:00:00.000Z'}};
  const downloads=[],removed=[];
  wx.getFileSystemManager=()=>({unlink({filePath}){removed.push(filePath);}});
  const c=new LiveConsentController({identity:()=>identity,emit(){},
    request:async()=>({success:true,data:{items:[row]}}),
    download:async url=>{downloads.push(url);return {tempFilePath:'cover-'+downloads.length};}});
  await c.load('9');
  assert.deepEqual(downloads,['/miniprogram/assistant/public-live/9/7/cover/71']);
  assert.equal(c.state.liveCoverPaths['71'],'cover-1');
  row={...row,versionId:'10',cover:{id:'72',capturedAt:'2026-11-04T01:15:00.000Z'}};
  await c.load('9');
  assert.deepEqual(removed,['cover-1']);assert.deepEqual(c.state.liveCoverPaths,{'72':'cover-2'});
  identity='visitor';row={...row,canDecide:false,cover:null};await c.load('9');
  assert.deepEqual(removed,['cover-1','cover-2']);assert.deepEqual(c.state.liveCoverPaths,{});
});

test('a late owner preview receipt cannot open WebView after the viewer identity changes',async()=>{
  env();let identity='owner',resolveWrite;const writes=new Promise(resolve=>{resolveWrite=resolve;});let opens=0;
  const c=new LiveConsentController({identity:()=>identity,emit(){},openPreview(){opens++;},
    request:async(_,method)=>method==='GET'?{success:true,data:{items:[{...card}]}}:writes});
  await c.load('9');const opening=c.decide('7','preview');
  identity='other';c.clear();await c.load('10');
  resolveWrite({success:true,data:{...card,revision:4}});
  assert.equal(await opening,false);assert.equal(opens,0);assert.equal(c.pending(),null);
});

test('camera WebView accepts the exact owner session and rejects a mismatched version',async()=>{
  const source=fs.readFileSync(require.resolve('../packages/construction/camera/camera'),'utf8');let page,version='8';
  const calls=[];
  new Function('Page','require','getApp','wx',source)(definition=>{page=definition;},module=>module.includes('identity-navigation')?
    {canAccessRoute:()=>false}:{request:async(...args)=>{calls.push(args);return {data:{versionId:version,revision:4,url:'http://127.0.0.1:3019'+path}};}},
    ()=>({globalData:{token:'synthetic'}}),{});
  page.setData=patch=>Object.assign(page.data,patch);
  page.onLoad({conversationId:'9',liveId:'7',versionId:'8',revision:'4'});page._visible=true;
  await page.open();
  assert.deepEqual(calls[0].slice(0,3),['/miniprogram/assistant/public-live/9/7/webview','POST',{versionId:'8',expectedRevision:4}]);
  assert.match(page.data.src,/^http:\/\/127\.0\.0\.1:3019\/construction-camera#ownerLive=1454\./);
  version='10';await page.open();assert.equal(page.data.src,'');assert.ok(page.data.error);
});

function publicPlayer(request) {
  const source = fs.readFileSync(require.resolve('../packages/construction/public-live/public-live'), 'utf8');
  let page;
  new Function('Page', 'require', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'wx', source)(
    definition => { page = definition; }, () => ({ request, getBaseUrls: () => ['http://127.0.0.1:3006/api'] }),
    () => 1, () => {}, () => 1, () => {}, { createVideoContext: () => ({ stop() {} }) },
  );
  return Object.assign(page, { options: { enterpriseId: '1454', key: card.key }, epoch: 0, alive: true, visible: true,
    setData(patch) { Object.assign(this.data, patch); } });
}

test('public 503 and decoder failures permit retry, and playback needs positive time progress', async () => {
  const detail = { key: card.key, versionId: card.versionId, revision: card.revision };
  let sessionUnavailable = true;
  const page = publicPlayer(async (_, method) => {
    if (method === 'POST' && sessionUnavailable) throw { statusCode: 503 };
    return { success: true, data: method === 'POST' ? { ...detail, url: path } : detail };
  });
  await page.connect();
  assert.equal(page.data.state, 'failed');
  assert.equal(page.data.error, '暂时无法连接直播，请重试。');
  assert.equal(page.data.src, '');
  sessionUnavailable = false;
  await page.retry();
  assert.ok(page.data.src.endsWith('/hls.m3u8'));
  for (const time of [undefined, 0, NaN]) page.played({ detail: { currentTime: time } });
  assert.equal(page.data.state, 'connecting');
  page.played({ detail: { currentTime: 0.25 } });
  assert.equal(page.data.state, 'playing');
  page.playbackError();
  assert.equal(page.data.state, 'failed');
  assert.equal(page.data.error, '暂时无法连接直播，请重试。');
  assert.equal(page.data.src, '');
});

test('withdrawal keeps the stopped feedback even if an old player reports an error', async () => {
  const detail = { key: card.key, versionId: card.versionId, revision: card.revision };
  let withdrawn = false;
  const page = publicPlayer(async (_, method) => withdrawn
    ? { success: false, code: 'public_live_unavailable' }
    : { success: true, data: method === 'POST' ? { ...detail, url: path } : detail });
  await page.connect();
  withdrawn = true;
  await page.check(page.epoch);
  page.playbackError();
  assert.equal(page.data.state, 'stopped');
  assert.equal(page.data.error, '直播已停止公开');
  await page.retry();
  assert.equal(page.data.state, 'stopped');
  assert.equal(page.data.error, '直播已停止公开');
});

test('lost receipt survives reentry and uses the exact original key/body',async()=>{
  env();let lose=true;const writes=[];
  const request=async(p,m,b,o)=>{if(m==='GET')return {success:true,data:{items:[{...card}]}};writes.push({p,b,key:o.headers['Idempotency-Key']});
    if(lose)throw {statusCode:503};return {success:true,data:{id:'7',versionId:'8',revision:4,status:'declined'}};};
  const options={identity:()=> 'owner',emit(){},request};const first=new LiveConsentController(options);await first.load('9');assert.equal(await first.decide('7','decline'),false);assert.equal(first.state.livePending,true);first.clear();
  lose=false;const next=new LiveConsentController(options);await next.load('9');assert.equal(next.state.livePending,true);assert.equal(await next.retry(),true);assert.deepEqual(writes[0],writes[1]);assert.equal(next.state.livePending,false);
});
