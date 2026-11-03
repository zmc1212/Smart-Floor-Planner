/** Dedicated local relay cleanup. Never starts/replays a provider operation. */
import { loadEnvConfig } from '@next/env';
import { setTimeout as delay } from 'node:timers/promises';
import { reconcileLiveProxies } from '@/lib/construction/public-live/media';
import { closePostgresPool } from '@/lib/postgresql';
loadEnvConfig(process.cwd(),true);
let stopping=false;
process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
async function main(){try{
  do{
    try{console.log(JSON.stringify({at:new Date().toISOString(),...await reconcileLiveProxies()}));}
    catch{console.error('public_live_cleanup_unavailable');}
    if(!process.argv.includes('--once')&&!stopping)await delay(5000);
  }while(!stopping&&!process.argv.includes('--once'));
}finally{await closePostgresPool();}}
main().catch(()=>{process.exitCode=1;});
