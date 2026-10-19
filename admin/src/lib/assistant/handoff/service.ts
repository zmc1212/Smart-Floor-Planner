import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, safeText, userContent, type ActorContext } from '../contracts';
import { appendMessage, cancelRuns, idempotent, conversationSource } from '../core/conversation';
import { allRequirementKeys } from '../requirements/contract';
import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';
import { agentMessageAvailable } from '../agent/media-context';
import { recordNeedIssueReview } from '@/lib/construction/need-issues';

type Handoff = { state: 'waiting' | 'active' | 'cancelled' | 'ended'; requestId: string; recipientId: string | null;
  recipientName: string; ownerId?: string; ownerName?: string; mediaConsent?: boolean; contactConsent: boolean; phone: string;
  requestedAt: string; packet: Row; source: Row; leadId: string | null };
const stateOf = (c: Row) => (c.entry_snapshot as Row)?.handoff as Handoff | undefined;

/** Shared by the existing customer action and a direct waiting-cancel message.
 * Callers retain the original scoped transaction, identity and conversation lock. */
async function persistCustomerHandoff(tx: PostgresTransaction, actor: ActorContext, c: Row, h: Handoff,
  action: 'request' | 'cancel' | 'end', requestKey: string, archiveConsent = false) {
  const conversationId = String(c.id);
  if (action !== 'request') await tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now(),updated_at=now(),version=version+1
    where enterprise_id=${actor.enterpriseId} and conversation_id=${conversationId} and participant_role='handoff_staff'`);
  await cancelRuns(tx, actor, conversationId);
  const mode = h.state === 'waiting' ? 'handoff_requested' : 'ai';
  await tx.execute(sql`update app.assistant_conversations set mode=${mode},entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${JSON.stringify(h)}::jsonb),
    context_revision=context_revision+1,version=version+1,updated_at=now() where enterprise_id=${actor.enterpriseId} and id=${conversationId}`);
  const event = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'assistant.handoff.customer.v1','assistant_conversation',${conversationId},${Number(c.version)+1},${JSON.stringify(actor.principal)}::jsonb,
      ${requestKey},${JSON.stringify({ action, requestId:h.requestId, recipientId:h.recipientId, contactConsent:h.contactConsent, mediaConsent:h.mediaConsent===true, leadId:h.leadId, archiveConsent, source:h.source })}::jsonb) returning id`);
  await appendMessage(tx, actor, conversationId, { author: 'system', eventId: String(event!.id), purpose: 'handoff.' + action,
    content: { version: 1, blocks: [{ type: 'text', text: action === 'request'
      ? '已提交，等待' + h.recipientName + '接待。你可以继续补充资料，小K已暂停自动回复。'
      : '本次接续已结束，小K恢复回复。' }] } });
}

/** Reenter the same locked, owned conversation; never end an active reception. */
export async function cancelWaitingHandoff(repo: AssistantRepository, conversationId: string, requestKey: string) {
  if (repo.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  const c = await repo.conversation(id(conversationId)), h = stateOf(c);
  if (c.status !== 'open' || c.mode !== 'handoff_requested' || h?.state !== 'waiting'
    || (c.entry_snapshot as Row)?.retentionRedacted) fail('context_changed');
  await persistCustomerHandoff(repo.tx, repo.actor, c, { ...h, state: 'cancelled' }, 'cancel', requestKey);
}
/** Dispatch metadata is not a grant to read consultation contents. */
export function dispatchHandoff(h: Handoff | undefined) {
  return h ? { state: h.state, requestId: h.requestId, recipientId: h.recipientId,
    recipientName: h.recipientName, requestedAt: h.requestedAt, ownerId: h.ownerId,
    ownerName: h.ownerName } : null;
}
export async function authorizeHandoffStaff(repo: AssistantRepository) {
  const a = repo.actor;
  if (a.principal.kind !== 'admin' || !a.capabilities.includes('assistant.handoff.staff')) fail('assistant_capability_forbidden', 403);
  const staff = await one(repo.tx, sql`select id,display_name,username,user_id,role from app.admin_users
    where enterprise_id=${a.enterpriseId} and id=${a.principal.adminId} and status='active'
      and role in ('designer','enterprise_admin') and must_change_password=false for share`);
  if (!staff) fail('assistant_capability_forbidden', 403);
  if (a.entry?.staffUserId) {
    if (String(staff.user_id) !== a.entry.staffUserId) fail('identity_context_invalid', 401);
    const current = await one(repo.tx, sql`select app.assistant_identity_is_current(${String(a.entry.staffUserId)}::bigint,${a.contextVersion}::integer) as valid`);
    if (!current?.valid) fail('identity_context_invalid', 401);
  }
  return staff;
}

/** Uses the existing tenant conversation lock, participant grant and run cancellation fence. */
export class HandoffService {
  constructor(readonly actor: ActorContext) {}
  private scoped<T>(write: boolean, fn: (repo: AssistantRepository) => Promise<T>) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      return fn(repo);
    });
  }
  private async eligible(repo: AssistantRepository, staffId: string) {
    return one(repo.tx, sql`select id,display_name,username from app.admin_users where enterprise_id=${this.actor.enterpriseId}
      and id=${staffId} and status='active' and role in ('designer','enterprise_admin') and must_change_password=false for share`);
  }
  private async project(repo: AssistantRepository, c: Row) {
    const h = stateOf(c);
    const staff = h?.ownerId ? await this.eligible(repo, h.ownerId) : null;
    const ownerAvailable = h?.state !== 'active' || !!staff;
    const entry = c.entry_snapshot as Row;
    let leadId = h?.leadId || (entry.kind === 'lead' ? String(entry.id) : null);
    if (leadId && this.actor.principal.kind === 'user' && !await one(repo.tx, sql`select id from app.leads where enterprise_id=${this.actor.enterpriseId}
      and id=${leadId} and customer_user_id=${this.actor.principal.userId} and archived_at is null and status not in ('closed','converted')`)) leadId = null;
    const packet = h && this.actor.principal.kind === 'user' ? { summary: h.packet.summary, messages: h.packet.messages, truncated: h.packet.truncated } : h?.packet;
    if (packet && Array.isArray(packet.messages)) {
      const projected: Row[] = [];
      for (const message of packet.messages as Row[]) projected.push(
        await agentMessageAvailable(repo.tx, this.actor.enterpriseId, String(c.id), String(message.id)) ? message
          : { ...message, text: '这条回答所依据的资料已不可用，请重新提问。' });
      packet.messages = projected;
    }
    return { conversationId: String(c.id), mode: c.mode, status: c.status, version: Number(c.version), handoff: h ? { ...h, packet: packet!, ownerAvailable } : null,
      appointmentUrl: leadId ? `/packages/business/appointment-booking/appointment-booking?mode=customer&leadId=${leadId}` : '/packages/business/lead-form/lead-form',
      appointmentNeedsArchive: !leadId };
  }
  customerRead(conversationId: string) {
    return this.scoped(false, async repo => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
      const c = await repo.conversation(id(conversationId));
      const recipients = await rows(repo.tx, sql`select id,coalesce(nullif(display_name,''),username) as name from app.admin_users
        where enterprise_id=${this.actor.enterpriseId} and status='active' and role in ('designer','enterprise_admin')
        and must_change_password=false order by id limit 100`);
      return { ...await this.project(repo, c), recipients: recipients.map(r => ({ id: String(r.id), name: String(r.name) })),
        leads: (await rows(repo.tx,sql`select id,name from app.leads where enterprise_id=${this.actor.enterpriseId} and customer_user_id=${this.actor.principal.userId}
          and archived_at is null and status not in ('closed','converted') order by id desc limit 100`)).map(l=>({id:String(l.id),name:String(l.name || '服务档案')})),
        disclosure: '将本次文字对话、需求摘要（含原话和待确认项）、本次及后续上传的图片资料、后续会话消息分享给所选接待人；选择企业接待团队时，企业内在职设计师和负责人可查看本次授权资料并接单。联系方式仅在另行同意后用于本次沟通。' };
    });
  }
  customerWrite(conversationId: string, requestKey: string, input: Row, guard?: (repo: AssistantRepository, conversation: Row) => Promise<void>,
    portfolio?: { workId: string; versionId: string; authorId: string }) {
    if (!['request','cancel','end'].includes(String(input.action)) || Object.keys(input).some(k => !['action','consent','contactConsent','phone','recipientId','leadId','archiveConsent','mediaConsent'].includes(k))) fail('invalid_message',422);
    return this.scoped(true, async repo => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden',403);
      const customerUserId = this.actor.principal.userId;
      const c = await repo.conversation(id(conversationId));
      await idempotent(repo.tx,this.actor,'handoff:'+conversationId,requestKey,portfolio ? { ...input, portfolio } : input,async()=>{
        await guard?.(repo, c);
        if (c.status !== 'open' || (c.entry_snapshot as Row)?.retentionRedacted) fail('context_changed');
        let h = stateOf(c);
        if (input.action === 'request') {
          if (input.consent === false || (input.contactConsent !== undefined && typeof input.contactConsent !== 'boolean') || (input.mediaConsent !== undefined && typeof input.mediaConsent !== 'boolean')) fail('invalid_message',422);
          if (h && ['waiting','active'].includes(h.state)) fail('context_changed');
          const recipientId = input.recipientId ? id(input.recipientId) : null;
          const recipient = recipientId ? await this.eligible(repo,recipientId) : null;
          if (recipientId && !recipient) fail('assistant_resource_not_found',404);
          const phone = input.contactConsent ? String(input.phone || '').trim() : '';
          if ((input.contactConsent && !/^1[3-9]\d{9}$/.test(phone)) || (!input.contactConsent && input.phone)) fail('invalid_message',422);
          const leadId = input.leadId ? id(input.leadId) : null;
          if (leadId && (input.archiveConsent !== true || !await one(repo.tx,sql`select id from app.leads where enterprise_id=${this.actor.enterpriseId}
            and id=${leadId} and customer_user_id=${customerUserId} and archived_at is null and status not in ('closed','converted') for share`))) fail('assistant_resource_not_found',404);
          const messages = await rows(repo.tx,sql`select id,seq,author_kind,content from app.assistant_messages where enterprise_id=${this.actor.enterpriseId}
            and conversation_id=${conversationId} order by seq desc limit 201`);
          // A packet may be bounded, but never pretend a truncated history is complete.
          const summary = await one(repo.tx,sql`select id,status,draft_fields,confirmed_fields from app.assistant_requirement_summaries
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
          h = { state:'waiting',requestId:requestKey,recipientId,recipientName:recipient ? String(recipient.display_name || recipient.username) : '企业接待团队',
            mediaConsent:true,contactConsent:input.contactConsent===true,phone,requestedAt:new Date().toISOString(),leadId,
            packet:{ summary:summary || null, messages:messages.slice(0,200).reverse().map(m=>({id:String(m.id),seq:String(m.seq),authorKind:m.author_kind,text:safeText(m.content as Parameters<typeof safeText>[0])})), truncated:messages.length>200 },
            source:{ ...conversationSource(c), ...(portfolio ? { portfolio } : {}) } };
        } else {
          if (!h || !['waiting','active'].includes(h.state)) fail('context_changed');
          h = {...h,state:input.action==='cancel'?'cancelled':'ended'};
        }
        await persistCustomerHandoff(repo.tx, this.actor, c, h, input.action as 'request' | 'cancel' | 'end', requestKey, input.archiveConsent === true);
        return {conversationId};
      });
      return this.project(repo,(await repo.conversation(conversationId)));
    });
  }
  staffList() {
    return this.scoped(false,async repo=>{
      await authorizeHandoffStaff(repo);
      const staffId = this.actor.principal.kind==='admin'?this.actor.principal.adminId:'';
      const list=await rows(repo.tx,sql`select * from app.assistant_conversations where enterprise_id=${this.actor.enterpriseId} and purpose='customer_consultation'
        and status='open' and ((entry_snapshot->'handoff'->>'state'='waiting' and (entry_snapshot->'handoff'->>'recipientId' is null or entry_snapshot->'handoff'->>'recipientId'=${staffId}))
          or (entry_snapshot->'handoff'->>'state'='active' and entry_snapshot->'handoff'->>'ownerId'=${staffId} and exists(select 1 from app.assistant_participants p
            where p.enterprise_id=app.assistant_conversations.enterprise_id and p.conversation_id=app.assistant_conversations.id and p.admin_id=${staffId} and p.status='active' and p.participant_role='handoff_staff'))) order by updated_at desc limit 100`);
      return {items:list.map(c=>({conversationId:String(c.id),title:c.title || '装修咨询',handoff:dispatchHandoff(stateOf(c)),version:Number(c.version)}))};
    });
  }
  private async staffConversation(repo:AssistantRepository, conversationId:string) {
    const staff=await authorizeHandoffStaff(repo);
    const c=await one(repo.tx,sql`select * from app.assistant_conversations where enterprise_id=${this.actor.enterpriseId} and id=${id(conversationId)} and purpose='customer_consultation' for update`);
    const h=c && stateOf(c), staffId=String(staff.id);
    if (!c || c.status!=='open' || !h || !['waiting','active'].includes(h.state) || (h.state==='waiting' && h.recipientId && h.recipientId!==staffId)
      || (h.state==='active' && h.ownerId!==staffId)) fail('assistant_resource_not_found',404);
    if(h.state==='active' && !await one(repo.tx,sql`select id from app.assistant_participants where enterprise_id=${this.actor.enterpriseId}
      and conversation_id=${conversationId} and admin_id=${staffId} and participant_role='handoff_staff' and status='active'`)) fail('assistant_resource_not_found',404);
    return {c,h,staff};
  }
  private async candidates(repo: AssistantRepository, conversationId: string, staff: Row) {
    const candidates = await rows(repo.tx, sql`select l.id,l.name,l.community_name,l.primary_floor_plan_id,f.name as plan_name,f.layout_data
      from app.leads l left join app.floor_plans f on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id and f.status='completed'
      where l.enterprise_id=${this.actor.enterpriseId} and l.archived_at is null and l.status not in ('closed','converted')
      and exists(select 1 from app.assistant_participants p where p.enterprise_id=l.enterprise_id and p.conversation_id=${conversationId}
        and p.user_id=l.customer_user_id and p.status='active')
      and (${staff.role === 'enterprise_admin'} or l.assigned_to=${String(staff.id)} or l.promoter_id=${String(staff.id)})
      order by l.id desc limit 100`);
    return candidates.map(l => ({ id: String(l.id), name: String(l.name || '服务档案'), community: String(l.community_name || ''),
      floorPlanId: l.layout_data && parseFormalSurveyLayout(l.layout_data) ? String(l.primary_floor_plan_id) : null,
      planName: l.plan_name || '', rooms: l.layout_data && parseFormalSurveyLayout(l.layout_data) ? adaptSurveyGraphToRooms(l.layout_data).map(r => ({ id: r.id, name: r.name })) : [] }));
  }
  staffRead(conversationId:string) {
    return this.scoped(false,async repo=>{
      const {c,h,staff}=await this.staffConversation(repo,conversationId);
      if (h.state === 'waiting') return { conversationId: String(c.id), mode: c.mode,
        status: c.status, version: Number(c.version), handoff: dispatchHandoff(h), messages: [] };
      const messages=h.state==='active'?await rows(repo.tx,sql`select id,seq,author_kind,admin_id,content from app.assistant_messages where enterprise_id=${this.actor.enterpriseId}
        and conversation_id=${conversationId} order by seq desc limit 100`):[];
      const summary = await one(repo.tx, sql`select id,status,draft_fields,confirmed_fields from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
      const projected = await this.project(repo,c);
      const packet: Row = { ...h.packet, summary: summary || null };
      for (const m of messages) if (!await agentMessageAvailable(repo.tx, this.actor.enterpriseId, conversationId, String(m.id))) {
        m.content = { version: 1, blocks: [{ type: 'text', text: '这条回答所依据的资料已不可用，请重新提问。' }] };
      }
      return {...projected, handoff: { ...projected.handoff, packet },
        candidates: await this.candidates(repo, conversationId, staff),
        messages:messages.reverse().map(m=>({id:String(m.id),seq:String(m.seq),authorKind:m.author_kind,isOwn: String(m.admin_id) === String(staff.id),text:safeText(m.content as Parameters<typeof safeText>[0])}))};
    });
  }
  staffWrite(conversationId:string,requestKey:string,input:Row) {
    if(!['claim','reply','end','release','correct','associate','link'].includes(String(input.action)) || Object.keys(input).some(k=>!['action','text','field','sourceMessageId','note','expectedVersion','mediaId','category','roomName','leadId','floorPlanId','roomId'].includes(k))) fail('invalid_message',422);
    return this.scoped(true,async repo=>{
      // Recheck identity before idempotent replay; stale grants must never restore content.
      await authorizeHandoffStaff(repo);
      const c=await one(repo.tx,sql`select id from app.assistant_conversations where enterprise_id=${this.actor.enterpriseId} and id=${id(conversationId)} for update`);
      if(!c) fail('assistant_resource_not_found',404);
      await idempotent(repo.tx,this.actor,'staff-handoff:'+conversationId,requestKey,input,async()=>{
        const {c: current,h,staff}=await this.staffConversation(repo,conversationId);
        if (['correct','associate','link'].includes(String(input.action))) {
          if (h.state !== 'active') fail('context_changed');
          if (Number(input.expectedVersion) !== Number(current.version)) fail('version_conflict');
          const candidates = await this.candidates(repo, conversationId, staff);
          const candidate = input.leadId ? candidates.find(l => l.id === input.leadId) : null;
          if (input.leadId && !candidate) fail('assistant_resource_not_found',404);
          const packet = { ...h.packet };
          const stamp = { staffId: String(staff.id), at: new Date().toISOString() };
          if (input.action === 'correct') {
            if (!allRequirementKeys.includes(input.field as typeof allRequirementKeys[number]) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1000
              || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000))) fail('invalid_message',422);
            const source = await one(repo.tx,sql`select id from app.assistant_messages where enterprise_id=${this.actor.enterpriseId}
              and conversation_id=${conversationId} and id=${id(input.sourceMessageId)} and author_kind='user'`);
            if (!source) fail('assistant_resource_not_found',404);
            const corrections = (packet.corrections || []) as Row[];
            if (corrections.length >= 200) fail('invalid_message',422);
            packet.corrections = [...corrections, { ...stamp, field: input.field, text: input.text.trim(), sourceMessageId: String(source.id), note: input.note || '' }];
            await recordNeedIssueReview(repo.tx, this.actor, conversationId, requestKey, input);
          } else if (input.action === 'associate') {
            if (!['','site','reference','floorplan'].includes(String(input.category)) || typeof input.roomName !== 'string' || input.roomName.length > 80) fail('invalid_message',422);
            if (input.floorPlanId && (!candidate || candidate.floorPlanId !== input.floorPlanId)) fail('assistant_resource_not_found',404);
            if (input.roomId && (!input.floorPlanId || !candidate?.rooms.some(r => r.id === input.roomId))) fail('assistant_resource_not_found',404);
            const media = await one(repo.tx, sql`select id from app.assistant_media where enterprise_id=${this.actor.enterpriseId}
              and conversation_id=${conversationId} and id=${id(input.mediaId)} and deleted_at is null`);
            if (!media || h.mediaConsent !== true) fail('assistant_resource_not_found',404);
            packet.mediaAnnotations = { ...(packet.mediaAnnotations as Row || {}), [String(media.id)]: { ...stamp, category: input.category,
              roomName: input.roomName, leadId: candidate?.id || null, floorPlanId: input.floorPlanId || null, roomId: input.roomId || null } };
          } else h.leadId = candidate?.id || null;
          h.packet = packet;
          await repo.tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${JSON.stringify(h)}::jsonb),
            version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
          await repo.tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
            values(${this.actor.enterpriseId},'assistant.handoff.review.v1','assistant_conversation',${conversationId},${Number(current.version)+1},
              ${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},${JSON.stringify({action:input.action,requestId:h.requestId,field:input.field || null,mediaId:input.mediaId || null})}::jsonb)`);
          return { conversationId };
        }
        if(input.action==='claim') {
          if(h.state!=='waiting') fail('context_changed');
          h.state='active';h.ownerId=String(staff.id);h.ownerName=String(staff.display_name || staff.username);
          await repo.tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,admin_id,participant_role,grant_basis)
            values(${this.actor.enterpriseId},${conversationId},'admin',${String(staff.id)},'handoff_staff',${JSON.stringify({kind:'customer_consent',requestId:h.requestId})}::jsonb)
            on conflict(enterprise_id,conversation_id,admin_id) where admin_id is not null do update set status='active',revoked_at=null,grant_basis=excluded.grant_basis,participant_role='handoff_staff',version=app.assistant_participants.version+1`);
        } else {
          if(h.state!=='active') fail('context_changed');
          if(input.action==='reply') {
            const content=userContent({version:1,blocks:[{type:'text',text:input.text}]});
            await appendMessage(repo.tx,this.actor,conversationId,{author:'admin',content,clientMessageId:requestKey,purpose:'human.reply'});
            return {conversationId};
          }
          h.state=input.action==='release'?'waiting':'ended';delete h.ownerId;delete h.ownerName;
          await repo.tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=now(),version=version+1
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and participant_role='handoff_staff'`);
        }
        await cancelRuns(repo.tx,this.actor,conversationId);
        await repo.tx.execute(sql`update app.assistant_conversations set mode=${h.state==='active'?'human':h.state==='waiting'?'handoff_requested':'ai'},
          entry_snapshot=jsonb_set(entry_snapshot,'{handoff}',${JSON.stringify(h)}::jsonb),context_revision=context_revision+1,version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
        const event = await one(repo.tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
          values(${this.actor.enterpriseId},'assistant.handoff.staff.v1','assistant_conversation',${conversationId},${Number(current.version)+1},${JSON.stringify(this.actor.principal)}::jsonb,
            ${requestKey},${JSON.stringify({action:input.action,requestId:h.requestId,staffId:String(staff.id)})}::jsonb) returning id`);
        await appendMessage(repo.tx, this.actor, conversationId, { author: 'system', eventId: String(event!.id), purpose: 'handoff.' + input.action,
          content: { version: 1, blocks: [{ type: 'text', text: input.action === 'claim' ? h.ownerName + '正在接待，小K保持暂停。'
            : input.action === 'release' ? '接待人已退出，本次咨询回到等待，小K保持暂停。' : '本次接续已结束，小K恢复回复。' }] } });
        return {conversationId};
      });
      return {conversationId};
    });
  }
}
