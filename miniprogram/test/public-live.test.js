const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {LiveConsentController}=require('../packages/assistant/lib/public-live');
const {publicConsultationId}=require('../utils/public-site-client');
const card={id:'7',versionId:'8',messageId:'20',revision:3,key:'a'.repeat(48),status:'pending_owner',statusLabel:'待你决定',available:true,canDecide:true,canWithdraw:true,alias:'客厅机位',name:'测试工地'};
const path='/api/public/construction-live/1454/'+card.key+'/media/'+'b'.repeat(43)+'/hls.m3u8';
function env(){const storage=new Map();global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)};return storage;}
function publicLivePage(request){
  const source=fs.readFileSync(require.resolve('../packages/construction/public-live/public-live'),'utf8'),calls=[];let page;
  new Function('Page','require','wx',source)(definition=>{page=definition;},module=>{
    if(module.includes('site-font'))return {loadSiteFont(){}};
    if(module.includes('public-site-client'))return {publicConsultationId:options=>publicConsultationId(options,request)};
    return {request};
  },{navigateTo:({url})=>calls.push(url)});
  page.setData=patch=>Object.assign(page.data,patch);return {page,calls};
}

test('the live page carries the exact public site into the verified original consultation', async () => {
  const checks = [];
  const {page,calls} = publicLivePage(async (url, method, body) => {
    checks.push({url, method, body});
    return {success:true,data:{enterprise:{id:'1454'}}};
  });
  page.alive = true;
  page.connect = () => page.setShareAvailable(true);
  const show = async options => {
    page.options = options;
    page.onShow();
    await new Promise(setImmediate);
    page.consult();
  };

  await show({conversationId:'9',enterpriseId:'1454',siteId:'23',versionId:'24'});
  assert.equal(page.data.canConsult, true);
  assert.deepEqual(calls, ['/packages/assistant/chat/chat?conversationId=9&publicSiteId=23&publicVersionId=24']);
  page.onHide();
  await show({enterpriseId:'1454',siteId:'23',versionId:'24'});
  assert.equal(page.data.canConsult, false);
  page.onHide();
  await show({conversationId:'9',enterpriseId:'1455',siteId:'23',versionId:'24'});
  assert.equal(page.data.canConsult, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(checks, Array(2).fill({url:'/miniprogram/assistant/entry-context',method:'POST',body:{conversationId:'9'}}));
});

test('the guide preview uses the confirmed live version and discards a response after withdrawal', async () => {
  let deliver;
  const request = new Promise(resolve => { deliver = resolve; });
  const calls = [];
  const {page} = publicLivePage((url, method, params) => {
    calls.push({ url, method, params });
    return request;
  });
  page.alive = page.visible = true;
  page.epoch = 1;
  page.consultationId = '9';
  page.options = {siteId:'23',versionId:'24',key:card.key};
  page.setData({detail:{key:'b'.repeat(48),versionId:'25'}});
  page.setShareAvailable(true);
  await page.loadGuide();
  assert.equal(calls.length, 0);

  page.setData({detail:{key:card.key,versionId:'25'}});
  const preview = page.loadGuide();
  assert.deepEqual(calls, [{url:'/miniprogram/assistant/conversations/9/public-sites/23/guide',method:'GET',
    params:{versionId:'24',liveKey:card.key,liveVersionId:'25'}}]);
  page.setShareAvailable(false);
  deliver({success:true,data:{question:'想先看看水电进展吗？'}});
  await preview;
  assert.equal(page.data.guideQuestion, '');

  page.setShareAvailable(true);
  await page.loadGuide();
  assert.equal(page.data.guideQuestion, '想先看看水电进展吗？');
  page.onHide();
  assert.equal(page.data.guideQuestion, '');
});

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

function ownerCamera(request) {
  const source=fs.readFileSync(require.resolve('../packages/construction/camera/camera'),'utf8');
  const globalData={token:'synthetic'}, calls=[];
  let page, now=0;
  new Function('Page','require','getApp','wx','Date',source)(definition=>{page=definition;},module=>module.includes('identity-navigation')?
    {canAccessRoute:()=>false}:{request:async(...args)=>{calls.push(args);return request(...args);}},
    ()=>({globalData}),{}, {now:()=>now});
  page.setData=patch=>Object.assign(page.data,patch);
  page.onLoad({conversationId:'9',liveId:'7',versionId:'8',revision:'4'});
  return {page,globalData,calls,advance:ms=>{now+=ms;}};
}
const ownerSession = (overrides={}) => ({data:{versionId:'8',revision:4,expiresInSeconds:120,url:'http://127.0.0.1:3019'+path,...overrides}});

test('camera WebView accepts the exact owner session and rejects a mismatched version',async()=>{
  let version='8';
  const {page,calls}=ownerCamera(()=>ownerSession({versionId:version}));
  await page.onShow();
  assert.deepEqual(calls[0].slice(0,3),['/miniprogram/assistant/public-live/9/7/webview','POST',{versionId:'8',expectedRevision:4}]);
  assert.match(page.data.src,/^http:\/\/127\.0\.0\.1:3019\/construction-camera#ownerLive=1454\./);
  version='10';await page.open();assert.equal(page.data.src,'');assert.ok(page.data.error);
});

test('owner preview retains the WebView on return and rechecks when its session expires or identity changes',async()=>{
  let denied=false;
  const {page,calls,globalData,advance}=ownerCamera(()=>{if(denied)throw new Error('forbidden');return ownerSession();});
  await page.onShow();
  const first=page.data.src;
  assert.ok(first);
  page.onHide();
  assert.equal(page.data.src,first);
  await page.onShow();
  assert.equal(page.data.src,first);
  assert.equal(calls.length,1);

  page.onHide();advance(120000);await page.onShow();
  assert.equal(calls.length,2);
  assert.ok(page.data.src);
  page.onHide();globalData.token='different';denied=true;await page.onShow();
  assert.equal(calls.length,3);
  assert.equal(page.data.src,'');
  assert.ok(page.data.error);
});

test('owner preview uses one pending entry across hide/show and cannot mount after exit',async()=>{
  for(const unload of [false,true]){
    let resolve;
    const {page,calls}=ownerCamera(()=>new Promise(r=>{resolve=r;}));
    const pending=page.onShow();
    page.onHide();
    if(unload)page.onUnload();
    else {await page.onShow();page.onHide();}
    assert.equal(calls.length,1);
    resolve(ownerSession());await pending;
    assert.equal(page.data.src,'');
    if(!unload){
      await page.onShow();
      assert.ok(page.data.src);
      assert.equal(calls.length,1);
    }
  }
});

function publicPlayer(request, shareMenu = []) {
  const source = fs.readFileSync(require.resolve('../packages/construction/public-live/public-live'), 'utf8');
  let page;
  new Function('Page', 'require', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'wx', source)(
    definition => { page = definition; }, () => ({ request, getBaseUrls: () => ['http://127.0.0.1:3006/api'] }),
    () => 1, () => {}, () => 1, () => {}, {
      createVideoContext: () => ({ stop() {}, pause() {} }),
      showShareMenu: options => shareMenu.push({ visible: true, ...options }),
      hideShareMenu: options => shareMenu.push({ visible: false, ...options }),
    },
  );
  return Object.assign(page, { options: { enterpriseId: '1454', key: card.key }, epoch: 0, alive: true, visible: true,
    setData(patch) { Object.assign(this.data, patch); } });
}

const playerEvent = (epoch, currentTime) => ({
  currentTarget: { dataset: { playerEpoch: epoch } },
  detail: { currentTime },
});

test('confirmed public live shares the approved title and cover at the exact anonymous entry, even while paused', async () => {
  const detail = { key: card.key, versionId: card.versionId, revision: card.revision, name: '测试工地直播' };
  const shareMenu = [];
  const page = publicPlayer(async (_, method) => ({ success: true, data: method === 'POST' ? { ...detail, url: path } : detail }), shareMenu);
  Object.assign(page.options, { conversationId: '19', leadId: '71', siteId: '23', versionId: '24' });
  const connecting = page.connect();
  assert.equal(page.data.shareAvailable, false);
  assert.equal(page.onShareAppMessage().path, '/pages/index/index');
  await connecting;
  page.played(playerEvent(page.epoch, 0.25));
  page.toggle();
  assert.equal(page.data.state, 'paused');
  assert.equal(page.data.shareAvailable, true);
  assert.deepEqual(shareMenu.at(-1), { visible: true, menus: ['shareAppMessage'] });
  assert.deepEqual(page.onShareAppMessage(), {
    title: detail.name,
    path: '/packages/construction/public-live/public-live?enterpriseId=1454&key=' + card.key,
    imageUrl: '/packages/construction/assets/notebook/public-live-share-cover.jpg',
  });
  page.onHide();
  assert.equal(page.data.shareAvailable, false);
  assert.equal(page.onShareAppMessage().path, '/pages/index/index');
});

test('revocation while opening a media session closes sharing and rejects the late player', async () => {
  const detail = { key: card.key, versionId: card.versionId, revision: card.revision };
  let resolveSession;
  const pending = new Promise(resolve => { resolveSession = resolve; });
  let revoked = false;
  const shareMenu = [];
  const page = publicPlayer(async (_, method) => {
    if (method === 'POST') return pending;
    return revoked ? { success: false, code: 'public_live_unavailable' } : { success: true, data: detail };
  }, shareMenu);
  const connecting = page.connect();
  await new Promise(setImmediate);
  assert.equal(page.data.shareAvailable, true);
  revoked = true;
  await page.check(page.epoch);
  resolveSession({ success: true, data: { ...detail, url: path } });
  await connecting;
  assert.equal(page.data.state, 'stopped');
  assert.equal(page.data.src, '');
  assert.equal(page.data.shareAvailable, false);
  assert.equal(page.onShareAppMessage().path, '/pages/index/index');
  assert.deepEqual(shareMenu.at(-1), { visible: false, menus: ['shareAppMessage'] });
});

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
  assert.equal(page.data.shareAvailable, true);
  sessionUnavailable = false;
  await page.retry();
  assert.ok(page.data.src.endsWith('/hls.m3u8'));
  for (const time of [undefined, 0, NaN]) page.played(playerEvent(page.epoch, time));
  assert.equal(page.data.state, 'connecting');
  page.played(playerEvent(page.epoch, 0.25));
  assert.equal(page.data.state, 'playing');
  page.playbackError(playerEvent(page.epoch));
  assert.equal(page.data.state, 'failed');
  assert.equal(page.data.error, '暂时无法连接直播，请重试。');
  assert.equal(page.data.src, '');
});

test('continuing public live waits for the new player and ignores late progress and errors', async () => {
  const detail = { key: card.key, versionId: card.versionId, revision: card.revision };
  const response = data => ({ success: true, data });
  let resolveSession;
  const pending = new Promise(resolve => { resolveSession = resolve; });
  let sessions = 0;
  const page = publicPlayer(async (_, method) => {
    if (method === 'GET') return response(detail);
    if (++sessions === 1) return response({ ...detail, url: path });
    return pending;
  });
  await page.connect();
  const oldEpoch = page.epoch;
  page.played(playerEvent(oldEpoch, 0.25));
  page.toggle();
  assert.equal(page.data.state, 'paused');

  page.toggle();
  assert.equal(page.data.src, '');
  page.played(playerEvent(oldEpoch, 3));
  assert.equal(page.data.state, 'connecting');
  resolveSession(response({ ...detail, url: path.replace('b'.repeat(43), 'c'.repeat(43)) }));
  await new Promise(setImmediate);
  assert.equal(sessions, 2);
  page.played(playerEvent(oldEpoch, 3));
  assert.equal(page.data.state, 'connecting');
  page.playbackError(playerEvent(oldEpoch));
  assert.equal(page.data.state, 'connecting');
  assert.equal(page.data.playerEpoch, page.epoch);
  assert.ok(page.data.src.includes('c'.repeat(43)));
  page.toggle();
  assert.equal(page.data.state, 'connecting');
  page.played(playerEvent(page.epoch, 0.25));
  assert.equal(page.data.state, 'playing');
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
  page.playbackError(playerEvent(page.epoch));
  assert.equal(page.data.state, 'stopped');
  assert.equal(page.data.error, '直播已停止公开');
  await page.retry();
  assert.equal(page.data.state, 'stopped');
  assert.equal(page.data.error, '直播已停止公开');
  assert.equal(page.data.shareAvailable, false);
});

test('lost receipt survives reentry and uses the exact original key/body',async()=>{
  env();let lose=true;const writes=[];
  const request=async(p,m,b,o)=>{if(m==='GET')return {success:true,data:{items:[{...card}]}};writes.push({p,b,key:o.headers['Idempotency-Key']});
    if(lose)throw {statusCode:503};return {success:true,data:{id:'7',versionId:'8',revision:4,status:'declined'}};};
  const options={identity:()=> 'owner',emit(){},request};const first=new LiveConsentController(options);await first.load('9');assert.equal(await first.decide('7','decline'),false);assert.equal(first.state.livePending,true);first.clear();
  lose=false;const next=new LiveConsentController(options);await next.load('9');assert.equal(next.state.livePending,true);assert.equal(await next.retry(),true);assert.deepEqual(writes[0],writes[1]);assert.equal(next.state.livePending,false);
});
