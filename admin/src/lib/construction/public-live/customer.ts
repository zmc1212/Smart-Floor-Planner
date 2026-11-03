import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { liveDecision } from './contract';
import { liveAudit, liveDto, liveEvent, liveRow, liveSource } from './store';

export class PublicLiveCustomer {
  constructor(readonly actor: ActorContext,readonly conversationId:string) {
    requireCapability(actor,'assistant.chat.self');id(conversationId);
    if(actor.principal.kind!=='user')fail('public_live_forbidden',403);
  }
  private scope<T>(fn:(tx:PostgresTransaction,c:Row)=>Promise<T>,write=false) {
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const r=new AssistantRepository(tx,this.actor);await r.settings(write);
      const c=await r.conversation(this.conversationId);
      if(c.purpose!=='customer_consultation')fail('public_live_forbidden',403);
      return fn(tx,c);
    });
  }
  private async own(tx:PostgresTransaction,liveId:string,versionId?:string) {
    const l=await liveRow(tx,this.actor.enterpriseId,id(liveId),true);
    const current= l && await one(tx,sql`select p.id from app.construction_projects p join app.leads lead on lead.enterprise_id=p.enterprise_id and lead.id=p.lead_id
      where p.enterprise_id=${this.actor.enterpriseId} and p.id=${String(l.project_id)} and lead.customer_user_id=${String(l.customer_id)} and lead.archived_at is null`);
    if(!l||!current||String(l.conversation_id)!==this.conversationId||String(l.customer_id)!==(this.actor.principal.kind==='user'?this.actor.principal.userId:'')
      ||versionId&&String(l.current_version_id)!==versionId||l.status==='draft')fail('public_live_unavailable',404);
    return l;
  }
  read() {
    return this.scope(async(tx,c)=>{
      const list=await rows(tx,sql`select id from app.construction_public_live where enterprise_id=${this.actor.enterpriseId} and conversation_id=${this.conversationId}
        and customer_id=${this.actor.principal.kind==='user'?this.actor.principal.userId:''} and status<>'draft' order by updated_at desc limit 30`);
      const items=[];
      for(const row of list){
        let l:Row;try{l=await this.own(tx,String(row.id));}catch{continue;}
        const v=await one(tx,sql`select * from app.construction_public_live_versions where enterprise_id=${this.actor.enterpriseId} and live_id=${String(l.id)} and id=${String(l.current_version_id)}`);
        if(!v)continue;
        const available=!!await liveSource(tx,this.actor.enterpriseId,String(l.id));
        items.push({...liveDto(l,v,available),messageId:String(l.message_id),canDecide:available&&l.status==='pending_owner'&&c.status==='open',
          canWithdraw:c.status==='open'&&['pending_owner','owner_approved','published','rejected'].includes(String(l.status))});
      }
      return {items};
    });
  }
  decide(liveId:string,action:string,input:unknown,requestKey:string) {
    const value=liveDecision(input);id(liveId);key(requestKey);
    if(!['preview','approve','decline','later','withdraw'].includes(action))fail('invalid_public_live',422);
    return this.scope(async(tx,c)=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-live-owner:${this.actor.enterpriseId}:${liveId}`},0))`);
      const l=await this.own(tx,liveId,value.versionId);
      const source=['preview','approve'].includes(action)?await liveSource(tx,this.actor.enterpriseId,liveId,value.versionId):null;
      if(['preview','approve'].includes(action)&&!source)fail('public_live_source_changed');
      return idempotent(tx,this.actor,'live:owner:'+action+':'+liveId,requestKey,input,async()=>{
        if(c.status!=='open')fail('conversation_read_only');
        if(Number(l.revision)!==value.expectedRevision)fail('version_conflict');
        if(action!=='withdraw'&&l.status!=='pending_owner')fail('public_live_state_conflict');
        if(action==='approve'&&String(l.previewed_version_id)!==value.versionId)fail('public_live_preview_required',422);
        const next=action==='approve'?'owner_approved':action==='decline'?'declined':action==='withdraw'?'withdrawn':'pending_owner';
        const updated=(await one(tx,sql`update app.construction_public_live set status=${next},revision=revision+1,updated_at=now(),
          previewed_version_id=${action==='preview'?value.versionId:l.previewed_version_id as string|null},
          consented_version_id=${action==='approve'?value.versionId:null},consented_by=${action==='approve'?String(l.customer_id):null},reviewed_by=null
          where enterprise_id=${this.actor.enterpriseId} and id=${liveId} returning *`))!;
        await liveAudit(tx,updated,this.actor.principal,'owner.'+action);
        if(!['preview','later'].includes(action))await liveEvent(tx,updated,'owner.'+action,this.actor);
        return {id:liveId,key:String(l.public_key),versionId:value.versionId,revision:Number(updated.revision),status:next,
          ...(action==='preview'&&source?{material:liveDto(updated,source.version)}:{})};
      });
    },!['withdraw','decline','later'].includes(action));
  }
}
