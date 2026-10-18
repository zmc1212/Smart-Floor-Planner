import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '../contracts';
import { idempotent } from './conversation';

export function usageWindow(from?:string|null,to?:string|null) {
  const end=to || new Date(Date.now()+86400000).toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(end)))fail('invalid_usage_window',422);
  const start=from || new Date(Date.parse(end)-30*86400000).toISOString().slice(0,10);
  for(const value of [start,end]) if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)fail('invalid_usage_window',422);
  const days=(Date.parse(end)-Date.parse(start))/86400000;
  if(days<1 || days>90)fail('invalid_usage_window',422);
  return {from:start,to:end};
}
export function exactAmount(value:unknown) {
  if(typeof value!=='string' || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value)>BigInt('9223372036854775807'))fail('invalid_usage_amount',422);
  return value;
}
async function authorize(tx:PostgresTransaction,actor:ActorContext,write=false) {
  if(actor.principal.kind!=='admin')fail('assistant_capability_forbidden',403);
  if(!await one(tx,sql`select a.id from app.admin_users a join app.enterprises e on e.id=a.enterprise_id
    where a.enterprise_id=${actor.enterpriseId} and a.id=${actor.principal.adminId} and a.role='enterprise_admin'
    and a.status='active' and not a.must_change_password and e.status='active'
    and 'assistant-usage'=any(a.menu_permissions)
    and (${!write} or 'assistant-usage-reconcile'=any(a.menu_permissions)) for share of a,e`))fail('assistant_capability_forbidden',403);
  const settings=await one(tx,sql`select * from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} for update`);
  if(!settings)fail('assistant_resource_not_found',404);
  return settings;
}
export class UsageService {
  constructor(private actor:ActorContext){}
  async summary(from?:string|null,to?:string|null) {
    const window=usageWindow(from,to),eid=this.actor.enterpriseId;
    return withTenantTransaction(eid,async tx=>{
      const settings=await authorize(tx,this.actor);
      const usage=await rows(tx,sql`select (created_at at time zone 'UTC')::date::text as day,category,measurement_kind,
        count(*)::text records,count(quantity)::text measured_records,sum(quantity)::text quantity,
        sum(input_tokens)::text input_tokens,sum(output_tokens)::text output_tokens,
        count(*) filter(where input_tokens is null)::text unknown_input_records,
        count(*) filter(where output_tokens is null)::text unknown_output_records
        from app.assistant_usage_records where enterprise_id=${eid} and created_at>=${window.from}::date::timestamp at time zone 'UTC'
        and created_at<${window.to}::date::timestamp at time zone 'UTC' group by 1,2,3 order by 1,2,3`);
      const runs=await rows(tx,sql`select (r.created_at at time zone 'UTC')::date::text as day,c.purpose,r.status,r.error_code,count(*)::text count
        from app.assistant_runs r join app.assistant_conversations c on c.enterprise_id=r.enterprise_id and c.id=r.conversation_id
        where r.enterprise_id=${eid} and r.created_at>=${window.from}::date::timestamp at time zone 'UTC' and r.created_at<${window.to}::date::timestamp at time zone 'UTC'
        group by 1,2,3,4 order by 1,2,3,4`);
      const indexing=await rows(tx,sql`select (started_at at time zone 'UTC')::date::text as day,operation,status,count(*)::text calls,
        sum(input_tokens)::text input_tokens,count(*) filter(where input_tokens is null)::text unknown_input_calls
        from app.assistant_knowledge_attempts where enterprise_id=${eid} and started_at>=${window.from}::date::timestamp at time zone 'UTC'
        and started_at<${window.to}::date::timestamp at time zone 'UTC' group by 1,2,3 order by 1,2,3`);
      const providers=await rows(tx,sql`select (created_at at time zone 'UTC')::date::text as day,status,count(*)::text calls
        from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id is not null
        and created_at>=${window.from}::date::timestamp at time zone 'UTC' and created_at<${window.to}::date::timestamp at time zone 'UTC'
        group by 1,2 order by 1,2`);
      const costs=await rows(tx,sql`select q.budget_date::text as day,q.status,count(*)::text requests,
        sum(q.settled_cost_micros)::text confirmed_cost_micros,sum(q.settled_tokens)::text confirmed_tokens,
        count(*) filter(where q.status='reconciling')::text unknown_cost_requests
        from app.assistant_quota_reservations q where q.enterprise_id=${eid} and q.budget_date>=${window.from}::date and q.budget_date<${window.to}::date
        group by 1,2 order by 1,2`);
      const budget=await one(tx,sql`select coalesce(sum(reserved_requests),0)::text requests,
        coalesce(sum(case when status='settled' then coalesce(settled_tokens,reserved_tokens) else reserved_tokens end),0)::text tokens,
        coalesce(sum(case when status='settled' then coalesce(settled_cost_micros,reserved_cost_micros) else reserved_cost_micros end),0)::text cost_micros,
        count(*) filter(where status='reconciling')::text pending_reviews
        from app.assistant_quota_reservations where enterprise_id=${eid} and status!='released'
        and (budget_date=(now() at time zone 'UTC')::date or status in ('held','reconciling'))`);
      return {window,timezone:'UTC',endExclusive:true,currency:settings.budget_currency,usage,runs,indexing,providers,costs,budget,
        limits:{requests:String(settings.daily_requests),tokens:String(settings.daily_tokens),costMicros:String(settings.daily_cost_micros)},
        definitions:{amounts:'Decimal integer strings; money in micro CNY. Null is unknown, not zero. Sums are known subtotals; inspect unknown counts.',tokens:'Text and query embedding records; indexing is separate. Missing input/output remains unknown. Pre-instrumentation query calls are not backfilled. Provider calls without usage remain visible in providers and unresolved quota.',costs:'Reviewed text-provider costs, attributed to original budget day. Local embedding infrastructure costs are not measured.',budget:'Text-token/provider-cost reservation accounting: current UTC day plus all unresolved holds from previous days. No customer billing.'}};
    });
  }
  async pending(cursor?:string,limit=20) {
    if(cursor)id(cursor);if(!Number.isInteger(limit)||limit<1||limit>100)fail('invalid_message',422);
    return withTenantTransaction(this.actor.enterpriseId,async tx=>{
      await authorize(tx,this.actor);
      const items=await rows(tx,sql`select q.id::text,q.run_id::text,q.version,q.budget_date::text,q.reserved_tokens::text,q.reserved_cost_micros::text,
        r.status run_status,r.error_code,q.created_at,
        (r.status not in ('queued','running') and not exists(select 1 from app.assistant_jobs j where j.enterprise_id=q.enterprise_id and j.run_id=q.run_id
          and (j.lease_expires_at>now() or j.provider_started_at>now()-interval '180 seconds'))) reviewable
        from app.assistant_quota_reservations q join app.assistant_runs r on r.enterprise_id=q.enterprise_id and r.id=q.run_id
        where q.enterprise_id=${this.actor.enterpriseId} and q.status='reconciling' and q.id>${cursor || '0'} order by q.id limit ${limit+1}`);
      const more=items.length>limit;return {items:items.slice(0,limit),nextCursor:more?String(items[limit-1].id):null};
    });
  }
  async detail(reservationId:string) {
    id(reservationId);const eid=this.actor.enterpriseId;
    return withTenantTransaction(eid,async tx=>{
      await authorize(tx,this.actor);
      const reservation=await one(tx,sql`select id::text,run_id::text,status,version,budget_date::text,reserved_tokens::text,reserved_cost_micros::text,
        settled_tokens::text,settled_cost_micros::text from app.assistant_quota_reservations where enterprise_id=${eid} and id=${reservationId}`);
      if(!reservation)fail('assistant_resource_not_found',404);
      const attempts=await rows(tx,sql`select id::text,status,created_at from app.ai_provider_attempts where enterprise_id=${eid} and assistant_run_id=${String(reservation.run_id)} order by id`);
      const review=await one(tx,sql`select id::text,reviewer_id::text,tokens::text,cost_micros::text,currency,evidence_reference,reason,created_at
        from app.assistant_cost_reviews where enterprise_id=${eid} and reservation_id=${reservationId}`);
      return {reservation,attempts,review:review ?? null};
    });
  }
  async reconcile(reservationId:string,body:Record<string,unknown>,requestKey:string) {
    id(reservationId);
    const allowed=['expectedVersion','tokens','costMicros','currency','evidenceReference','reason'];
    if(Object.keys(body).some(k=>!allowed.includes(k)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<1 || body.currency!=='CNY')fail('invalid_message',422);
    const tokens=exactAmount(body.tokens),cost=exactAmount(body.costMicros);
    for(const [field,max] of [['evidenceReference',500],['reason',1000]] as const) if(typeof body[field]!=='string' || body[field].trim().length<5 || body[field].length>max)fail('invalid_message',422);
    const actor=this.actor,eid=actor.enterpriseId;
    return withTenantTransaction(eid,async tx=>{
      await authorize(tx,actor,true);
      return idempotent(tx,actor,'usage-review:'+reservationId,requestKey,body,async()=>{
        const q=await one(tx,sql`select q.*,r.status run_status from app.assistant_quota_reservations q join app.assistant_runs r on r.enterprise_id=q.enterprise_id and r.id=q.run_id
          where q.enterprise_id=${eid} and q.id=${reservationId} for update of q,r`);
        if(!q)fail('assistant_resource_not_found',404);
        if(q.status!=='reconciling' || Number(q.version)!==body.expectedVersion)fail('usage_review_conflict');
        if(['queued','running'].includes(String(q.run_status)) || await one(tx,sql`select id from app.assistant_jobs where enterprise_id=${eid} and run_id=${String(q.run_id)}
          and (lease_expires_at>now() or provider_started_at>now()-interval '180 seconds')`))fail('usage_call_in_flight');
        // Legacy adapters cannot report usage. A review requires external evidence for BOTH tokens and money.
        const observed=await one(tx,sql`select sum(quantity)::text tokens from app.assistant_usage_records where enterprise_id=${eid} and run_id=${String(q.run_id)} and category='tokens' and measurement_kind='observed'`);
        if(observed?.tokens!==null && observed?.tokens!==undefined && BigInt(String(observed.tokens))!==BigInt(tokens))fail('usage_observed_tokens_conflict');
        const review=await one(tx,sql`insert into app.assistant_cost_reviews(enterprise_id,reservation_id,reviewer_id,tokens,cost_micros,currency,evidence_reference,reason)
          values(${eid},${reservationId},${actor.principal.kind==='admin'?actor.principal.adminId:null},${tokens},${cost},'CNY',${String(body.evidenceReference)},${String(body.reason)}) returning id::text,created_at`);
        await tx.execute(sql`update app.assistant_quota_reservations set status='settled',settled_tokens=${tokens},settled_cost_micros=${cost},version=version+1,updated_at=now() where enterprise_id=${eid} and id=${reservationId}`);
        return {reservationId,reviewId:String(review!.id),status:'settled',tokens,costMicros:cost,currency:'CNY',version:Number(q.version)+1,createdAt:review!.created_at};
      });
    });
  }
}
