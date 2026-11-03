import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { siteActor } from '../site-chat';
import type { ConstructionActor } from '../contracts';
import { liveDecision, liveDraft } from './contract';
import { liveAudit, liveDto, liveEvent, liveSource, staffLiveAccess } from './store';

export class PublicLiveService {
  constructor(readonly actor: ConstructionActor) {}
  read(pid: string) {
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const eid=this.actor.enterpriseId,access=await staffLiveAccess(tx,this.actor,id(pid));
      const cameras=await rows(tx,sql`select b.id::text as "bindingId",c.name from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
        where b.enterprise_id=${eid} and b.project_id=${pid} and b.ended_at is null and c.enabled order by b.id`);
      const l=await one(tx,sql`select * from app.construction_public_live where enterprise_id=${eid} and project_id=${pid} for share`);
      const v=l?.current_version_id?await one(tx,sql`select * from app.construction_public_live_versions where enterprise_id=${eid} and live_id=${String(l.id)} and id=${String(l.current_version_id)}`):null;
      const proxy=l?await one(tx,sql`select state,error_code from app.construction_public_live_proxies where enterprise_id=${eid} and live_id=${String(l.id)} and version_id=${String(l.current_version_id)}`):null;
      return { canPrepare:true,canReview:access.owner,revision:Number(l?.revision||0),cameras,
        material:l&&v?{...liveDto(l,v,!!await liveSource(tx,eid,String(l.id))),bindingId:String(v.binding_id)}:null,
        proxy:proxy?{state:String(proxy.state),errorCode:String(proxy.error_code)}:null };
    });
  }
  save(pid:string,input:unknown,requestKey:string) {
    const draft=liveDraft(input);key(requestKey);id(pid);
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const eid=this.actor.enterpriseId,aid=this.actor.adminId,access=await staffLiveAccess(tx,this.actor,pid,true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-live:${eid}:${pid}`},0))`);
      return idempotent(tx,siteActor(this.actor),'live:save:'+pid,requestKey,input,async()=>{
        let l=await one(tx,sql`select * from app.construction_public_live where enterprise_id=${eid} and project_id=${pid} for update`);
        if (Number(l?.revision||0)!==draft.expectedRevision)fail('version_conflict');
        if(l&&['pending_owner','owner_approved','published'].includes(String(l.status)))fail('public_live_stop_required');
        if(l&&await one(tx,sql`select id from app.construction_public_live_proxies where enterprise_id=${eid} and live_id=${String(l.id)} and state not in('stopped','failed')`))fail('public_live_stop_required');
        const c=await one(tx,sql`select c.*,b.id as binding_id from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
          where b.enterprise_id=${eid} and b.project_id=${pid} and b.id=${draft.bindingId} and b.ended_at is null and c.enabled
          and not exists(select 1 from app.construction_camera_controls x where x.enterprise_id=b.enterprise_id and x.camera_id=c.id and x.stop_required)
          for share of b,c`);
        if(!c)fail('public_live_source_changed');
        if(!l)l=(await one(tx,sql`insert into app.construction_public_live(enterprise_id,project_id,public_key,prepared_by,customer_id)
          values(${eid},${pid},${randomBytes(24).toString('hex')},${aid},${String(access.project.customer_user_id)}) returning *`))!;
        const scope={name:draft.name,audience:'public-visitors-including-shares',audio:false,replay:false,ptz:false,capture:false,
          customerId:String(access.project.customer_user_id),bindingId:draft.bindingId,cameraId:String(c.id),cameraVersion:Number(c.version),preparedActor:this.actor};
        const v=(await one(tx,sql`insert into app.construction_public_live_versions(enterprise_id,project_id,live_id,binding_id,camera_id,camera_version,alias,scope,scope_hash,prepared_by)
          values(${eid},${pid},${String(l.id)},${draft.bindingId},${String(c.id)},${Number(c.version)},${draft.alias},${JSON.stringify(scope)}::jsonb,${fingerprint(scope)},${aid}) returning *`))!;
        l=(await one(tx,sql`update app.construction_public_live set public_key=${randomBytes(24).toString('hex')},current_version_id=${String(v.id)},revision=${draft.expectedRevision+1},status='draft',prepared_by=${aid},customer_id=${String(access.project.customer_user_id)},
          conversation_id=null,message_id=null,previewed_version_id=null,consented_version_id=null,consented_by=null,reviewed_by=null,reason='',updated_at=now()
          where enterprise_id=${eid} and id=${String(l.id)} returning *`))!;
        await liveAudit(tx,l,this.actor,'save');return liveDto(l,v);
      });
    });
  }
  mutate(pid:string,action:string,input:unknown,requestKey:string) {
    const value=liveDecision(input);id(pid);key(requestKey);
    if(!['submit','publish','reject','withdraw'].includes(action))fail('invalid_public_live',422);
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      const eid=this.actor.enterpriseId,access=await staffLiveAccess(tx,this.actor,pid,action!=='withdraw');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-live:${eid}:${pid}`},0))`);
      const l=await one(tx,sql`select * from app.construction_public_live where enterprise_id=${eid} and project_id=${pid} for update`);
      if(!l)fail('public_live_unavailable',404);
      if(['publish','reject'].includes(action)&&!access.owner)fail('public_live_forbidden',403);
      const source=action!=='withdraw'?await liveSource(tx,eid,String(l.id),value.versionId):null;
      if(action!=='withdraw'&&!source)fail('public_live_source_changed');
      return idempotent(tx,siteActor(this.actor),'live:'+action+':'+pid,requestKey,input,async()=>{
        if(Number(l.revision)!==value.expectedRevision||String(l.current_version_id)!==value.versionId)fail('version_conflict');
        if(action==='submit'&&l.status!=='draft')fail('public_live_state_conflict');
        if(['publish','reject'].includes(action)&&(l.status!=='owner_approved'||String(l.consented_version_id)!==value.versionId||String(l.consented_by)!==String(l.customer_id)))fail('public_live_consent_required');
        let cid=l.conversation_id;
        if(action==='submit'){
          const c=await one(tx,sql`select c.id from app.assistant_conversations c join app.assistant_participants a on a.enterprise_id=c.enterprise_id and a.conversation_id=c.id and a.user_id=${String(l.customer_id)} and a.status='active'
            where c.enterprise_id=${eid} and c.purpose='customer_consultation' and c.status='open'
              and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=${String(access.project.lead_id)}) order by c.id desc limit 1 for update of c`);
          if(!c)fail('public_live_owner_chat_required');cid=c.id;
        }
        const next={submit:'pending_owner',publish:'published',reject:'rejected',withdraw:'withdrawn'}[action]!;
        const updated=(await one(tx,sql`update app.construction_public_live set status=${next},revision=revision+1,conversation_id=${cid as string|null},reason=${value.reason},updated_at=now(),
          reviewed_by=${action==='publish'?this.actor.adminId:null},previewed_version_id=${action==='submit'?null:l.previewed_version_id as string|null},
          consented_version_id=${['withdraw','reject','submit'].includes(action)?null:l.consented_version_id as string|null},consented_by=${['withdraw','reject','submit'].includes(action)?null:l.consented_by as string|null}
          where enterprise_id=${eid} and id=${String(l.id)} returning *`))!;
        await liveAudit(tx,updated,this.actor,action,value.reason);await liveEvent(tx,updated,action,siteActor(this.actor));
        return {id:String(l.id),key:String(l.public_key),versionId:value.versionId,revision:Number(updated.revision),status:next};
      });
    });
  }
}
