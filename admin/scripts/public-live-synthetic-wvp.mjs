/** Synthetic WVP protocol endpoint, private to this package's isolated service. */
import http from 'node:http';
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:18085');let data;
  if(u.pathname==='/api/user/login')data={accessToken:'synthetic-public-live-only'};
  else if(u.pathname==='/api/device/query/devices/99999999999999999991/channels')data={list:[{deviceId:'99999999999999999992',name:'合成测试视频',status:'ON'}]};
  else if(u.pathname==='/api/play/start/99999999999999999991/99999999999999999992')data={app:'synthetic',stream:'live_source'};
  else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({code:0,data}));
});
server.listen(18085,'127.0.0.1',()=>console.log('Synthetic WVP endpoint 18085 ready; no physical device access'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
