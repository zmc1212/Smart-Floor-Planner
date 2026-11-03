const test=require('node:test'),assert=require('node:assert/strict');
const {LiveConsentController,mediaUrl}=require('../packages/assistant/lib/public-live');
const card={id:'7',versionId:'8',messageId:'20',revision:3,key:'a'.repeat(48),status:'pending_owner',statusLabel:'待你决定',available:true,canDecide:true,canWithdraw:true,alias:'客厅机位',name:'测试工地'};
const path='/api/public/construction-live/1454/'+card.key+'/media/'+'b'.repeat(43)+'/hls.m3u8';
function env(){const storage=new Map();global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)};return storage;}
test('approval needs the current full preview; a changed version clears the expanded state',async()=>{
  env();let current={...card};const calls=[];
  const c=new LiveConsentController({identity:()=> 'owner',emit(){},request:async(p,m,b)=>{calls.push({p,m,b});if(m==='GET')return {success:true,data:{items:[{...current}]}};
    if(p.endsWith('/session'))return {success:true,data:{url:path}};current={...current,revision:4};return {success:true,data:{...current,material:{...current}}};}});
  await c.load('9');assert.equal(await c.decide('7','approve'),false);assert.equal(calls.filter(r=>r.m==='POST').length,0);
  assert.equal(await c.decide('7','preview'),true);assert.equal(c.state.liveExpanded,'7');assert.ok(c.state.livePreviewUrl.includes('/media/'));
  current={...current,versionId:'10',messageId:'21',revision:5,available:false};await c.load('9');assert.equal(c.state.liveExpanded,'');assert.equal(c.state.livePreviewUrl,'');
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
