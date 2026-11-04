/** Dedicated relay cleanup and scheduled owner preview covers. */
import { loadEnvConfig } from '@next/env';
import { setTimeout as delay } from 'node:timers/promises';
import { reconcileLiveProxies } from '@/lib/construction/public-live/media';
import { captureDueLiveCovers } from '@/lib/construction/public-live/cover';
import { closePostgresPool } from '@/lib/postgresql';
loadEnvConfig(process.cwd(),true);
let stopping=false;
let nextCoverCheck=0;
let coverRun:Promise<void>|undefined;
const once=process.argv.includes('--once');
process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
async function main(){try{
  do{
    try{console.log(JSON.stringify({at:new Date().toISOString(),...await reconcileLiveProxies()}));}
    catch{console.error('public_live_cleanup_unavailable');}
    if(!once&&!stopping&&!coverRun&&Date.now()>=nextCoverCheck){
      nextCoverCheck=Date.now()+60000;
      coverRun=captureDueLiveCovers().then(result=>{console.log(JSON.stringify(result));})
        .catch(()=>{console.error('public_live_cover_unavailable');}).finally(()=>{coverRun=undefined;});
    }
    if(!once&&!stopping)await delay(5000);
  }while(!stopping&&!once);
}finally{await coverRun;await closePostgresPool();}}
main().catch(()=>{process.exitCode=1;});
