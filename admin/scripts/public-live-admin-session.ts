/** One-use loopback sign-in for the already-created isolated synthetic owner. */
import fs from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
loadEnvConfig(process.cwd(),true);
async function main(){
  const f=JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json','utf8'));
  const token=await new SignJWT({id:f.adminIds.enterprise_admin,role:'enterprise_admin',enterpriseId:f.eid,permissions:['construction-projects']})
    .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const ticket='/session/'+randomUUID();let used=false;
  const server=http.createServer((req,res)=>{
    if(req.url===ticket&&!used){used=true;res.writeHead(303,{'Set-Cookie':'auth_token='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=900','Location':'http://127.0.0.1:3019/construction-projects','Cache-Control':'no-store'});res.end();return;}
    if(req.url==='/logout'){res.writeHead(200,{'Set-Cookie':'auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0','Content-Type':'text/plain'});res.end('Synthetic session closed');return;}
    res.writeHead(404);res.end();
  });
  server.listen(18086,'127.0.0.1',()=>console.log('http://127.0.0.1:18086'+ticket));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
