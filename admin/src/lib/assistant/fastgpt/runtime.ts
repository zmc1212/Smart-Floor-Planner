import fs from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {FastGPTReportWorkflow} from '@/lib/construction/fastgpt-report-workflow';
import {FastGPTKnowledgeWorkflow} from './knowledge-workflow';
import {FastGPTNativeKnowledge} from './native-knowledge';
import {FastGPTNativeRag} from './native-rag';
import {FastGPTAgentV2} from './agent-v2/runtime';
import {parseAgentV2Configuration, type AgentV2Configuration} from './agent-v2/config';
import type {RagConfiguration} from './rag-config';

type Configuration={baseUrl:string;apiKey:string;knowledgeAppId:string;stageAppId:string;auditFile?:string;
  nativeKnowledgeAppId?:string; nativeModel?:string; nativeTransportModel?:string; nativeBridgeKey?:string; rag?:RagConfiguration;
  agentV2?:AgentV2Configuration};
class FastGPTWorkflows {
  readonly knowledge:FastGPTKnowledgeWorkflow;
  readonly stage:FastGPTReportWorkflow;
  readonly nativeKnowledge?:FastGPTNativeKnowledge;
  readonly rag?:FastGPTNativeRag;
  readonly unified?:FastGPTNativeKnowledge;
  readonly agentV2?:FastGPTAgentV2;
  private server?:http.Server;
  private starting?:Promise<void>;
  constructor(configuration:Configuration) {
    const record=(kind:string,value:unknown)=>{
      if(configuration.auditFile)fs.appendFileSync(configuration.auditFile,JSON.stringify({kind,at:new Date().toISOString(),value},(_key,v)=>typeof v==='bigint'?String(v):v)+'\n');
    };
    this.knowledge=new FastGPTKnowledgeWorkflow({...configuration,appId:configuration.knowledgeAppId,record:value=>record('knowledge',value)});
    this.stage=new FastGPTReportWorkflow({...configuration,appId:configuration.stageAppId,record:value=>record('stage',value)},['stage']);
    if(configuration.rag?.mode==='unified') this.unified=new FastGPTNativeKnowledge({baseUrl:configuration.baseUrl,apiKey:configuration.apiKey,
      appId:configuration.rag.appId,model:configuration.rag.transportModel,bridgeKey:configuration.rag.bridgeKey,
      plainAnswers:true,routePrefix:'/unified',record:value=>record('unified',value)});
    else if(configuration.rag) this.rag=new FastGPTNativeRag({...configuration.rag,baseUrl:configuration.baseUrl,apiKey:configuration.apiKey,record:value=>record('rag',value)});
    if(configuration.nativeKnowledgeAppId) this.nativeKnowledge=new FastGPTNativeKnowledge({
      ...configuration,appId:configuration.nativeKnowledgeAppId,model:configuration.nativeTransportModel!,bridgeKey:configuration.nativeBridgeKey!,
      record:value=>record('nativeKnowledge',value)});
    if(configuration.agentV2) this.agentV2=new FastGPTAgentV2({...parseAgentV2Configuration(configuration.agentV2),
      baseUrl:configuration.baseUrl,apiKey:configuration.apiKey,record:value=>record('agentV2',value)});
  }
  async handle(request:Request) {
    if(new URL(request.url).pathname.startsWith('/agent-v2-')) return this.agentV2?.handle(request) ?? Response.json({error:'not_found'},{status:404});
    if(new URL(request.url).pathname.startsWith('/unified-')) return this.unified?.handle(request) ?? Response.json({error:'not_found'},{status:404});
    if(new URL(request.url).pathname.startsWith('/rag-')) return this.rag?.handle(request) ?? Response.json({error:'not_found'},{status:404});
    if(new URL(request.url).pathname.startsWith('/native-')) return this.nativeKnowledge?.handle(request) ?? Response.json({error:'not_found'},{status:404});
    return new URL(request.url).pathname.startsWith('/knowledge-')?this.knowledge.handle(request):this.stage.handle(request);
  }
  ready():Promise<void> {
    this.starting??=new Promise((resolve,reject)=>{
      this.server=http.createServer(async(req,res)=>{
        try{
          const chunks:Buffer[]=[];let length=0;
          for await(const chunk of req){length+=chunk.length;if(length>64000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
          const response=await this.handle(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers as HeadersInit,
            ...(['GET','HEAD'].includes(req.method||'GET')?{}:{body:Buffer.concat(chunks)})}));
          res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
        }catch{res.writeHead(503);res.end();}
      });
      this.server.once('error',reject);this.server.listen(18310,'127.0.0.1',()=>{this.server!.unref();resolve();});
    });
    return this.starting;
  }
  async close(){if(this.server?.listening)await new Promise<void>((resolve,reject)=>this.server!.close(error=>error?reject(error):resolve()));}
}
// Next dev re-evaluates route bundles on recompilation; keeping the bridge and
// its active tool tickets module-local leaves a stale listener holding 18310.
const cache=globalThis as typeof globalThis&{__xiaokFastGPTWorkflows?:{file:string;hash:string;runtime:FastGPTWorkflows}};
/** Explicit development opt-in. No product route, session, scheduler or
 * default provider configuration is changed by importing this module. */
export function fastGPTWorkflows():FastGPTWorkflows|undefined {
  const file=process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  if(!file)return;
  const bytes=fs.readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');
  const current=cache.__xiaokFastGPTWorkflows;
  if(current){if(current.file!==file||current.hash!==hash)throw Error('FastGPT workflow configuration changed during the Worker lifetime');return current.runtime;}
  const configuration=JSON.parse(bytes.toString('utf8')) as Configuration;
  if(!configuration.apiKey||![configuration.knowledgeAppId,configuration.stageAppId].every(id=>/^[a-f0-9]{24}$/.test(id)))throw Error('Invalid FastGPT workflow configuration');
  const runtime=new FastGPTWorkflows(configuration);cache.__xiaokFastGPTWorkflows={file,hash,runtime};return runtime;
}
export async function closeFastGPTWorkflows(){const owned=cache.__xiaokFastGPTWorkflows;cache.__xiaokFastGPTWorkflows=undefined;await owned?.runtime.close();}
