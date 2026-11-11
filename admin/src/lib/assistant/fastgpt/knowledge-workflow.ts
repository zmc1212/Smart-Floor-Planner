import {createHash, randomUUID} from 'node:crypto';
import {fail} from '@/lib/assistant/contracts';
import type {ModelTurnOutput} from '@/lib/assistant/contracts/model';

export type KnowledgePacket = {agentOutput?:ModelTurnOutput; attemptId?:string|number|bigint|null};
export type KnowledgeDispatch = {
  enterpriseId:string; runId:string; conversationId:string; turn:number;
  requestHash:string; question:string; model:string; toolNames:string[];
};
type Guard = {authorize:()=>Promise<unknown>};
type Ticket = {input:KnowledgeDispatch; guard:Guard; invoke:()=>Promise<KnowledgePacket>;
  expires:number; pending?:Promise<KnowledgePacket>; result?:KnowledgePacket; receipt?:string; accepted?:boolean; failed?:boolean;
  /** Set when the dispatch that owns this ticket has ended (success or error).
   * A callback that already holds this object must never start the model. */
  closed?:boolean};
const notDispatched = Symbol('fastgpt-knowledge-not-dispatched');

/** True only when the FastGPT platform never reached the model port. A failed
 * fetch, startup error or pre-model platform rejection is then safe to answer
 * through the configured provider; an accepted-but-ambiguous model call is not. */
export function fastGPTKnowledgeNotDispatched(error: unknown) {
  return !!error && typeof error === 'object' && (error as Record<symbol, unknown>)[notDispatched] === true;
}

/** FastGPT organizes one knowledge-model turn. The existing Agent owns the
 * messages, tools, memory, source checks and final answer. No alternate tool
 * wire format, autonomous tool loop or provider retry is introduced here. */
export class FastGPTKnowledgeWorkflow {
  private tickets=new Map<string,Ticket>();
  constructor(private config:{baseUrl:string;appId:string;apiKey:string;record:(entry:unknown)=>void}) {
    const url=new URL(config.baseUrl);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='18300')throw Error('FastGPT requires the isolated loopback endpoint');
  }
  /** A callback may keep running after the dispatch that created its ticket has
   * already failed. Every await boundary re-confirms that this exact ticket is
   * still the live, open entry before the model is allowed to start. */
  private live(id:string,ticket:Ticket) {
    return !ticket.closed&&this.tickets.get(id)===ticket;
  }
  async handle(request:Request):Promise<Response> {
    const id=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
    const ticket=this.tickets.get(id);
    if(!ticket||ticket.closed||ticket.expires<Date.now())return Response.json({error:'not_found'},{status:404});
    try {
      await ticket.guard.authorize();
      if(!this.live(id,ticket))return Response.json({error:'context_unavailable'},{status:409});
      const path=new URL(request.url).pathname;
      if(path==='/knowledge-input'&&request.method==='GET')return Response.json(ticket.input);
      if(request.method!=='POST')return Response.json({error:'not_found'},{status:404});
      const text=await request.text();if(text.length>4096)return Response.json({error:'invalid_request'},{status:400});
      const body=JSON.parse(text);
      if(path==='/knowledge-turn') {
        if(body.requestHash!==ticket.input.requestHash)return Response.json({error:'conflict'},{status:409});
        if(ticket.failed)return Response.json({error:'provider_outcome_unavailable'},{status:409});
        // The dispatch may have ended while this callback waited for
        // authorization or read the request. Once it is closed the model port
        // must stay unused, otherwise the Worker's not-dispatched fallback and
        // this late invocation would race for the same model step.
        if(!this.live(id,ticket))return Response.json({error:'context_unavailable'},{status:409});
        // Concurrent/repeated HTTP calls await the same original provider
        // attempt. An error never clears this promise or permits a replay.
        ticket.pending??=ticket.invoke();
        try{ticket.result=await ticket.pending;}catch{ticket.failed=true;return Response.json({error:'provider_outcome_unavailable'},{status:502});}
        await ticket.guard.authorize();
        if(!this.live(id,ticket))return Response.json({error:'context_unavailable'},{status:409});
        ticket.receipt=createHash('sha256').update(JSON.stringify(ticket.result,(_key,value)=>typeof value==='bigint'?String(value):value)).digest('hex');
        return Response.json({receipt:ticket.receipt,state:'model_returned_not_saved'});
      }
      if(path==='/knowledge-result') {
        if(!ticket.receipt||body.receipt!==ticket.receipt||!ticket.result)return Response.json({error:'conflict'},{status:409});
        ticket.accepted=true;
        return Response.json({receipt:ticket.receipt,state:'model_returned_not_saved'});
      }
      return Response.json({error:'not_found'},{status:404});
    }catch{return Response.json({error:'context_unavailable'},{status:409});}
  }
  async dispatch<T extends KnowledgePacket>(input:KnowledgeDispatch,guard:Guard,invoke:()=>Promise<T>):Promise<T> {
    await guard.authorize();
    const id=randomUUID()+randomUUID(),chatId=`xiaok-knowledge-${input.runId}-${input.turn}-${randomUUID()}`;
    const ticket:Ticket={input,guard,invoke,expires:Date.now()+180000};this.tickets.set(id,ticket);
    try {
      const response=await fetch(this.config.baseUrl+'/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(150000),
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.config.apiKey},
        body:JSON.stringify({appId:this.config.appId,chatId,stream:false,detail:true,variables:{workflowTicket:id},messages:[{role:'user',content:'AUTO_EXECUTE'}]})});
      const packet=await response.json();
      this.config.record({runId:input.runId,conversationId:input.conversationId,turn:input.turn,chatId,
        response:JSON.parse(JSON.stringify(packet).replaceAll(id,'[expired scoped ticket]').replaceAll(this.config.apiKey,'[redacted]')),
        attemptId:ticket.result?.attemptId?String(ticket.result.attemptId):null,usage:ticket.result?.agentOutput?.usage||null});
      if(!response.ok||packet.error||!ticket.accepted||packet.choices?.[0]?.message?.content?.trim()!==ticket.receipt)fail('fastgpt_workflow_unavailable',502);
      await guard.authorize();
      // Return the server-bound original result, not model-controlled data
      // copied out of a platform response. Provider observations stay intact.
      return ticket.result as T;
    }catch(error){
      // Close first: a callback object already handed to the platform must see
      // this state before it can claim the model port. Only a ticket that never
      // started the model makes the failure a safe not-dispatched fallback;
      // a started call keeps its unknown/conservative outcome and is never
      // re-sent through the configured provider.
      ticket.closed=true;
      const started=!!ticket.pending||!!ticket.result;
      if (!started && error && typeof error === 'object')
        Object.defineProperty(error, notDispatched, { value: true });
      this.config.record({runId:input.runId,turn:input.turn,chatId,platformOutcome:'unavailable',
        modelOutcome:ticket.result?'returned':ticket.pending?'started_unknown':'closed_before_dispatch',
        dispatched:started,
        error:String(error).replaceAll(id,'[expired scoped ticket]').replaceAll(this.config.apiKey,'[redacted]')});
      throw error;
    }finally{ticket.closed=true;this.tickets.delete(id);}
  }
}
