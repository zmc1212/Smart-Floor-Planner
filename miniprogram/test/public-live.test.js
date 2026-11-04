const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {LiveConsentController,mediaUrl}=require('../packages/assistant/lib/public-live');
const card={id:'7',versionId:'8',messageId:'20',revision:3,key:'a'.repeat(48),status:'pending_owner',statusLabel:'待你决定',available:true,canDecide:true,canWithdraw:true,alias:'客厅机位',name:'测试工地'};
const path='/api/public/construction-live/1454/'+card.key+'/media/'+'b'.repeat(43)+'/hls.m3u8';
function env(){const storage=new Map();global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)};return storage;}
test('approval needs the current full preview; an unavailable version clears the expanded state',async()=>{
  env();let current={...card};const calls=[];
  const c=new LiveConsentController({identity:()=> 'owner',emit(){},request:async(p,m,b)=>{calls.push({p,m,b});if(m==='GET')return {success:true,data:{items:[{...current}]}};
    if(p.endsWith('/session'))return {success:true,data:{url:path}};current={...current,revision:4};return {success:true,data:{...current,material:{...current}}};}});
  await c.load('9');assert.equal(await c.decide('7','approve'),false);assert.equal(calls.filter(r=>r.m==='POST').length,0);
  assert.equal(await c.decide('7','preview'),true);assert.equal(c.state.liveExpanded,'7');assert.ok(c.state.livePreviewUrl.includes('/media/'));
  current={...current,versionId:'10',messageId:'21',revision:5,available:false};await c.load('9');assert.equal(c.state.liveExpanded,'');assert.equal(c.state.livePreviewUrl,'');
});

function previewJourney() {
  env();let current={...card},sessionFailure=false;const calls=[];
  const c=new LiveConsentController({identity:()=> 'owner',emit(){},request:async(p,m,b)=>{
    calls.push({p,m,b});
    if(m==='GET')return {success:true,data:{items:[{...current}]}};
    if(p.endsWith('/session')){if(sessionFailure)throw {code:'public_live_not_configured'};return {success:true,data:{url:path}};}
    const action=p.split('/').at(-1);current={...current,revision:current.revision+1,status:{preview:'pending_owner',approve:'owner_approved',decline:'declined',later:'pending_owner'}[action]};
    return {success:true,data:{...current,material:{...current}}};
  }});
  return {c,calls,change:patch=>Object.assign(current,patch),failSession:value=>{sessionFailure=value;},approvals:()=>calls.filter(r=>r.p.endsWith('/approve'))};
}

test('a media-session failure leaves the scope readable but cannot submit consent',async()=>{
  const j=previewJourney();j.failSession(true);await j.c.load('9');await j.c.decide('7','preview');
  assert.equal(j.c.state.liveExpanded,'7');assert.equal(j.c.state.livePreviewUrl,'');
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(j.approvals().length,0);
  assert.match(j.c.state.liveError,/暂不可用/);
});

test('a URL or play intent alone is not a delivered preview; real progress enables this version only',async()=>{
  const j=previewJourney();await j.c.load('9');await j.c.decide('7','preview');
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(j.approvals().length,0);
  const attempt=j.c.state.livePreviewAttempt;
  for(const time of [undefined,0,-1,NaN,Infinity])j.c.playbackProgress('7',attempt,time);
  assert.equal(await j.c.decide('7','approve'),false);
  j.c.playbackProgress('7',attempt,0.25);assert.equal(j.c.state.livePreviewReady,true);
  assert.equal(await j.c.decide('7','approve'),true);assert.equal(j.approvals().length,1);
  assert.equal(j.approvals()[0].b.versionId,'8');assert.equal(j.approvals()[0].b.expectedRevision,4);
});

test('a decoder error revokes preview readiness and retry ignores late callbacks from the old player',async()=>{
  const j=previewJourney();await j.c.load('9');await j.c.decide('7','preview');
  const old=j.c.state.livePreviewAttempt;
  j.c.playbackProgress('7',old,1);j.c.playbackFailed('7',old);
  assert.equal(j.c.state.liveExpanded,'7');assert.equal(j.c.state.livePreviewReady,false);
  assert.match(j.c.state.liveError,/^暂时无法连接直播/);
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(j.approvals().length,0);
  await j.c.preview('7');const current=j.c.state.livePreviewAttempt;assert.notEqual(current,old);
  j.c.playbackProgress('7',old,2);j.c.playbackFailed('7',old);
  assert.ok(j.c.state.livePreviewUrl);assert.equal(j.c.state.livePreviewReady,false);
  j.c.playbackProgress('7',current,1);assert.equal(j.c.state.livePreviewReady,true);
  assert.equal(j.c.state.liveError,'');assert.equal(await j.c.decide('7','approve'),true);
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

test('a still-available replacement version cannot inherit expansion, media or readiness',async()=>{
  const j=previewJourney();await j.c.load('9');await j.c.decide('7','preview');
  j.change({versionId:'10',messageId:'21',revision:5,available:true});await j.c.load('9');
  assert.equal(j.c.state.liveExpanded,'');assert.equal(j.c.state.livePreviewUrl,'');
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(j.approvals().length,0);
});

test('unchanged reentry retains a current preview, while a new revision invalidates it',async()=>{
  const j=previewJourney();await j.c.load('9');await j.c.decide('7','preview');
  const old=j.c.state.livePreviewAttempt;j.c.playbackProgress('7',old,1);
  await j.c.load('9');assert.equal(j.c.state.livePreviewReady,true);
  j.change({revision:6});await j.c.load('9');j.c.playbackProgress('7',old,2);
  assert.equal(j.c.state.liveExpanded,'');assert.equal(j.c.state.livePreviewUrl,'');
  assert.equal(await j.c.decide('7','approve'),false);
});

test('a lost approval receipt can only reconcile the original decision after preview state is cleared',async()=>{
  const j=previewJourney(),request=j.c.request,writes=[];
  j.c.request=async(p,m,b,o)=>{
    if(!p.endsWith('/approve'))return request(p,m,b,o);
    writes.push({p,b,key:o.headers['Idempotency-Key']});
    if(writes.length===1){j.change({revision:5,status:'owner_approved',canDecide:false});throw {statusCode:503};}
    return {success:true,data:{id:'7',versionId:'8',revision:5,status:'owner_approved'}};
  };
  await j.c.load('9');await j.c.decide('7','preview');j.c.playbackProgress('7',j.c.state.livePreviewAttempt,1);
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(j.c.state.livePending,true);
  j.c.clear();await j.c.load('9');assert.equal(j.c.state.livePreviewReady,false);
  assert.equal(await j.c.decide('7','approve'),false);assert.equal(writes.length,1);
  assert.equal(await j.c.retry(),true);assert.deepEqual(writes[1],writes[0]);assert.equal(j.c.state.livePending,false);
});

test('an obsolete session completion or identity callback cannot revive a replaced preview',async()=>{
  env();let identity='owner',current={...card},resolveSession;const ready=new Promise(resolve=>{resolveSession=resolve;});
  const c=new LiveConsentController({identity:()=>identity,emit(){},request:async(p,m)=>{
    if(m==='GET')return {success:true,data:{items:[{...current}]}};
    if(p.endsWith('/session'))return ready;
    current={...current,revision:4};return {success:true,data:{...current}};
  }});
  await c.load('9');const opening=c.decide('7','preview');
  await new Promise(resolve=>setImmediate(resolve));
  const old=c.state.livePreviewAttempt;identity='visitor';await c.load('10');
  resolveSession({success:true,data:{url:path}});await opening;
  c.playbackProgress('7',old,1);c.playbackFailed('7',old);
  assert.equal(c.state.livePreviewUrl,'');assert.equal(c.state.livePreviewReady,false);
  assert.equal(c.state.liveExpanded,'');assert.equal(c.state.liveError,'');
});
test('lost receipt survives reentry and uses the exact original key/body',async()=>{
  env();let lose=true;const writes=[];
  const request=async(p,m,b,o)=>{if(m==='GET')return {success:true,data:{items:[{...card}]}};writes.push({p,b,key:o.headers['Idempotency-Key']});
    if(lose)throw {statusCode:503};return {success:true,data:{id:'7',versionId:'8',revision:4,status:'declined'}};};
  const options={identity:()=> 'owner',emit(){},request};const first=new LiveConsentController(options);await first.load('9');assert.equal(await first.decide('7','decline'),false);assert.equal(first.state.livePending,true);first.clear();
  lose=false;const next=new LiveConsentController(options);await next.load('9');assert.equal(next.state.livePending,true);assert.equal(await next.retry(),true);assert.deepEqual(writes[0],writes[1]);assert.equal(next.state.livePending,false);
});
test('identity change clears all preview/card data and cannot consume another identity operation',async()=>{
  env();let identity='owner';const c=new LiveConsentController({identity:()=>identity,emit(){},request:async()=>({success:true,data:{items:[{...card}]}})});
  await c.load('9');c.set({liveExpanded:'7',livePreviewUrl:'old'});identity='visitor';await c.load('10');assert.equal(c.state.liveExpanded,'');assert.equal(c.state.livePreviewUrl,'');assert.equal(c.pending(),null);
});
test('only server-owned HLS paths are accepted, without private source URLs or credentials',()=>{
  assert.equal(mediaUrl('http://127.0.0.1:3019'+path),'http://127.0.0.1:3019'+path);
  assert.equal(mediaUrl('https://example.test'+path),'https://example.test'+path);
  for(const invalid of ['rtsp://camera/private','https://user:password@example.test'+path,'https://example.test/private/live.m3u8',path+'?source=private'])assert.throws(()=>mediaUrl(invalid));
});
