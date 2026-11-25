import { SignJWT, jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows } from '@/db/repositories/assistant-repository';
import { currentCustomerService } from '@/db/repositories/customer-service';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { ReferrerNetworkRepository } from '@/db/repositories/referrer-network-repository';
import { fail, id, isPublicAssistantScope, type ActorContext } from '../contracts';
import { publicActor, readPublicAssistantScope, PUBLIC_ASSISTANT_SCOPE, publicActorEntry } from './public-scope';
import { configuredGuidance, guidanceOpening, guidanceView } from '../requirements/guidance';
import { readContentEntry, contentEntrySource, contentChannel, contentGreeting, type ContentEntry } from '../knowledge/content-entry';
import { acquisitionEntryView } from '../acquisition/config';
import { readAcquisitionSettings } from '../acquisition/settings';
import { latestCustomerReportContext } from '@/lib/construction/report-reference';
import { developmentReviewEnabled } from '../agent/review-runtime';
import { getJwtSecret } from '@/lib/jwt-secret';

export async function customerIdentity(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) fail('identity_context_invalid', 401);
  const payload = await verifyMiniProgramToken(request.headers.get('authorization')?.slice(7) || '');
  if (!payload || !context.user.openid) fail('identity_context_invalid', 401);
  if (context.mode !== 'customer') fail('assistant_capability_forbidden', 403);
  return {
    userId: context.user._id,
    contextVersion: payload.contextVersion,
    enterpriseId: context.enterpriseId,
    phone: context.user.phone,
    nickname: context.user.nickname,
  };
}
type Identity = Pick<Awaited<ReturnType<typeof customerIdentity>>, 'userId' | 'contextVersion' | 'enterpriseId'>;
export function actorFor(identity: Identity, enterpriseId: string, entry?: Record<string, unknown>): ActorContext {
  return { enterpriseId, principal: { kind: 'user', userId: identity.userId }, contextVersion: identity.contextVersion,
    customerServiceRequired: true, capabilities: ['assistant.chat.self'], entry };
}
function entrySecret() {
  return getJwtSecret();
}
/** Platform locator returns IDs only, never conversation/message/knowledge bodies. */
export async function locate(identity: Identity, kind: 'conversation' | 'run' | 'citation', targetId: string) {
  id(targetId);
  const found = await withPlatformTransaction(async tx => {
    const { enterpriseId } = await currentCustomerService(tx, identity.userId);
    const locateInTenant = (tenantId: string, publicOnly = false) => one(tx, sql`select c.enterprise_id,c.id,
        coalesce(c.entry_snapshot->>'scope','private') as scope from app.assistant_conversations c
        join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
        ${kind === 'run' ? sql`join app.assistant_runs r on r.enterprise_id=c.enterprise_id and r.conversation_id=c.id` : sql``}
        ${kind === 'citation' ? sql`join app.assistant_message_citations x on x.enterprise_id=c.enterprise_id and x.conversation_id=c.id` : sql``}
        where c.enterprise_id=${tenantId} and ${kind === 'run' ? sql`r.id` : kind==='citation'?sql`x.id`:sql`c.id`}=${targetId}
        and p.user_id=${identity.userId} and p.status='active' and c.purpose='customer_consultation'
        ${publicOnly ? sql`and c.entry_snapshot->>'scope'=${PUBLIC_ASSISTANT_SCOPE}` : sql`and c.entry_snapshot->>'scope' is distinct from ${PUBLIC_ASSISTANT_SCOPE}`}`);
    if (enterpriseId) {
      const privateFound = await locateInTenant(String(enterpriseId));
      if (privateFound) return privateFound;
    }
    const publicScope = await readPublicAssistantScope(tx);
    if (!publicScope) return null;
    const publicFound = await locateInTenant(publicScope.enterpriseId, true);
    return publicFound ? { ...publicFound, publicConfigVersion: publicScope.config.version } : null;
  });
  if (!found) fail('assistant_resource_not_found', 404);
  if (String(found.scope) === PUBLIC_ASSISTANT_SCOPE) {
    const scope = await withPlatformTransaction(tx => readPublicAssistantScope(tx));
    if (!scope || scope.enterpriseId !== String(found.enterprise_id)
      || Number(found.publicConfigVersion) !== Number(scope.config.version)) fail('assistant_resource_not_found', 404);
    return publicActor(identity, scope, { kind: 'public_history', conversationId: String(found.id) });
  }
  return actorFor(identity, String(found.enterprise_id));
}
async function recentPublicConsultation(tx: PostgresTransaction, enterpriseId: string, userId: string) {
  const row = await one<{ id: string }>(tx, sql`select c.id::text from app.assistant_conversations c
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
    where c.enterprise_id=${enterpriseId} and c.purpose='customer_consultation'
      and c.entry_snapshot->>'scope'=${PUBLIC_ASSISTANT_SCOPE} and c.status='open'
      and p.user_id=${userId} and p.status='active'
      and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false)
    order by c.id desc limit 1`);
  return row?.id ?? null;
}

export async function entryContext(identity: Identity, body: Record<string, unknown>) {
  const fields = ['entryCode', 'leadId', 'conversationId','referenceEntry', 'portfolioEntry', 'publicEnterpriseId'].filter(k => body[k] !== undefined);
  if (fields.length > 1 || Object.keys(body).some(k => !fields.includes(k))) fail('entry_context_invalid', 422);
  if (body.portfolioEntry !== undefined) fail('assistant_share_preview_only', 403);
  const { enterpriseId, ambiguous } = await withPlatformTransaction(tx => currentCustomerService(tx, identity.userId));
  let publicHistoryActor: ActorContext | null = null;
  // An explicit conversation link may refer to an older public consultation
  // even after the visitor has joined an enterprise. locate() verifies the
  // participant and public marker before we switch scope.
  if (body.conversationId !== undefined) {
    const located = await locate(identity, 'conversation', id(body.conversationId));
    if (isPublicAssistantScope(located)) publicHistoryActor = located;
  }
  const publicRequested = !!publicHistoryActor || !enterpriseId && fields.length === 0;
  if (ambiguous && !publicRequested) fail('customer_service_ambiguous', 409);
  if (publicRequested) {
    const publicScope = await withPlatformTransaction(tx => readPublicAssistantScope(tx));
    if (!publicScope) fail('assistant_service_code_required', 403);
    const basis = publicHistoryActor
      ? { kind: 'public_history', conversationId: String(body.conversationId) }
      : { kind: 'public_consultation' };
    const actor = publicActor(identity, publicScope, basis);
    const { settings, resumeConversationId } = await withTenantTransaction(publicScope.enterpriseId, async tx => {
      const settings = await new AssistantRepository(tx, actor).settings();
      let resumeConversationId: string | null = null;
      if (publicHistoryActor) {
        const row = await one<{ id: string }>(tx, sql`select c.id::text from app.assistant_conversations c
          join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
          where c.enterprise_id=${publicScope.enterpriseId} and c.id=${String(body.conversationId)}
            and c.purpose='customer_consultation' and c.entry_snapshot->>'scope'=${PUBLIC_ASSISTANT_SCOPE}
            and p.user_id=${identity.userId} and p.status='active' limit 1`);
        if (!row) fail('assistant_resource_not_found', 404);
        resumeConversationId = String(row.id);
      } else {
        resumeConversationId = await recentPublicConsultation(tx, publicScope.enterpriseId, identity.userId);
      }
      return { settings, resumeConversationId };
    });
    const entryToken = await new SignJWT({ scope: PUBLIC_ASSISTANT_SCOPE, enterpriseId: publicScope.enterpriseId,
      publicConfigVersion: publicScope.config.version, contextVersion: identity.contextVersion,
      basis: publicActorEntry(publicScope, basis) }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(identity.userId).setAudience('assistant-entry').setIssuedAt().setExpirationTime('15m').sign(entrySecret());
    return { scope: PUBLIC_ASSISTANT_SCOPE, entryToken, expiresIn: 900, enterprise: null,
      publicTopics: publicScope.config.publicTopics, guidanceOpening: publicScope.config.guidanceOpening,
      capabilities: actor.capabilities, resumeConversationId,
      canSend: publicScope.config.enabled && assistantWritesEnabled(settings),
      maxMessageChars: Number(settings?.max_message_chars) || 4000,
      guidanceEnabled: publicScope.config.enabled, guidance: null };
  }
  if (ambiguous) fail('customer_service_ambiguous', 409);
  if (!enterpriseId) fail('assistant_service_code_required', 403);
  let basis: Record<string, unknown> = { kind: 'identity' };
  let contentEntry:ContentEntry|null=null;
  let homeEntry = fields.length === 0;
  if (body.publicEnterpriseId) {
    if (id(body.publicEnterpriseId) !== enterpriseId) fail('assistant_share_preview_only', 403);
    basis = { kind: 'public_site_entry' };
  } else if (body.referenceEntry) {
    contentEntry = await readContentEntry(body.referenceEntry);
    if (contentEntry.enterpriseId !== enterpriseId) fail('assistant_share_preview_only', 403);
    basis={kind:'reference_content',...contentEntry};
  } else if (body.conversationId) {
    const actor = await locate(identity, 'conversation', id(body.conversationId));
    if (actor.enterpriseId !== enterpriseId) fail('assistant_resource_not_found', 404);
    basis = { kind: 'conversation', id: body.conversationId };
  } else if (body.leadId) {
    const lead = await withTenantTransaction(enterpriseId, tx => one(tx, sql`select id from app.leads where id=${id(body.leadId)}
      and enterprise_id=${enterpriseId} and customer_user_id=${identity.userId} and archived_at is null`));
    if (!lead) fail('assistant_resource_not_found', 404);
    basis = { kind: 'lead', id: String(lead.id) };
  } else if (body.entryCode) {
    if (typeof body.entryCode !== 'string' || !/^(rp_|sa_)?[A-Za-z0-9_-]{32}$/.test(body.entryCode)) fail('entry_context_invalid', 422);
    const token = body.entryCode;
    const resolved = await withPlatformTransaction(async tx => {
      const repository = new ReferrerNetworkRepository(tx);
      const candidates = token.length === 32 ? ['rp_' + token, 'sa_' + token] : [token];
      for (const candidate of candidates) {
        if (candidate.startsWith('rp_')) {
          const result = await repository.resolvePromotionToken({ token: candidate });
          if (result.result === 'ok' && result.code && result.membership) return {
            enterpriseId: String(result.code.enterpriseId), kind: 'promotion_code', id: String(result.code.id),
            promotionCodeId: String(result.code.id), membershipId: String(result.membership.id), codeVersion: result.code.version
          };
        } else {
          const result = await repository.resolveStaffActivityToken({ token: candidate });
          if (result.result === 'ok' && result.code && result.staff) return {
            enterpriseId: String(result.code.enterpriseId), kind: 'staff_activity_code', id: String(result.code.id),
            staffActivityCodeId: String(result.code.id), staffId: String(result.staff.id), codeVersion: result.code.version
          };
        }
      }
      return null;
    });
    if (!resolved) fail('entry_context_invalid', 422);
    if (resolved.enterpriseId !== enterpriseId) homeEntry = true;
    else {
      basis = { kind: resolved.kind, id: resolved.id,
        promotionCodeId: 'promotionCodeId' in resolved ? resolved.promotionCodeId : undefined,
        membershipId: 'membershipId' in resolved ? resolved.membershipId : undefined,
        staffActivityCodeId: 'staffActivityCodeId' in resolved ? resolved.staffActivityCodeId : undefined,
        staffId: 'staffId' in resolved ? resolved.staffId : undefined,
        codeVersion: resolved.codeVersion };
    }
  }
  const actor = actorFor(identity, enterpriseId, basis);
  const { enterprise, settings, reference, resumeConversationId, staffProfileLeadId, acquisition } = await withTenantTransaction(enterpriseId, async tx => {
    const settings = await new AssistantRepository(tx, actor).settings();
    const enterprise = await one(tx, sql`select id,name,logo from app.enterprises where id=${enterpriseId}`);
    if (homeEntry) {
      const live = await rows<{ id: string }>(tx, sql`select l.id::text as id from app.leads l
        join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
          and p.status='active' and p.customer_access
        where l.enterprise_id=${enterpriseId} and l.customer_user_id=${identity.userId} and l.archived_at is null
          and l.status<>'closed' group by l.id having count(*)=1 order by l.id limit 2`);
      if (live.length === 1) basis = { kind: 'lead', id: live[0].id };
    }
    const acquisitionEntry = ['promotion_code', 'staff_activity_code'].includes(String(basis.kind))
      ? await readAcquisitionSettings(tx, enterpriseId!)
      : null;
    const acquisition = acquisitionEntry
      ? acquisitionEntryView(acquisitionEntry.config, enterprise ?? null, acquisitionEntry.version)
      : null;
    if (acquisition) {
      basis.acquisition = acquisition;
      basis.acquisitionVersion = acquisitionEntry!.version;
      // The QR claim creates the lead before chat entry. Bind the single live
      // lead in this enterprise so requirement/profile work continues on the
      // real project; multiple live leads stay unbound instead of guessing.
      const activeLeads = await rows<{ id: string }>(tx, sql`select id::text from app.leads
        where enterprise_id=${enterpriseId!} and customer_user_id=${identity.userId}
          and archived_at is null and status<>'closed' order by id limit 2`);
      if (activeLeads.length === 1) basis.renovationLeadId = activeLeads[0].id;
    }
    // A home entry with exactly one live project binds its newest published
    // report so "今天工地做了什么" answers from the same facts the 工地 page
    // shows. Ambiguous projects and unresolved grants stay unbound.
    if (!basis.reportContext && basis.kind === 'lead' && homeEntry) {
      const boundReport = await latestCustomerReportContext(tx, actor, String(basis.id));
      if (boundReport) basis.reportContext = boundReport;
    }
    const reference=contentEntry?await contentEntrySource(tx,contentEntry):null;
    if(contentEntry&&!reference)basis={kind:'reference_unavailable',enterpriseId};
    else if(contentEntry){
      try{basis.channel=await contentChannel(tx,enterpriseId!,contentEntry.channelCode);}catch{basis={kind:'reference_unavailable',enterpriseId};}
    }
    // A public company entry conveys no project/customer grant. Resume the
    // visitor's own latest open consultation so returning to the chat continues
    // where they left off; a project-bound home entry resumes only consultations
    // created from that same lead.
    const ids = body.publicEnterpriseId || homeEntry ? await rows<{id:string}>(tx, sql`select c.id::text from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
      where c.enterprise_id=${enterpriseId!} and c.purpose='customer_consultation' and c.status='open'
        and p.user_id=${identity.userId} and p.status='active' and not coalesce((c.entry_snapshot->>'retentionRedacted')::boolean,false)
        ${basis.kind === 'lead' ? sql`and c.entry_snapshot->>'kind'='lead' and c.entry_snapshot->>'id'=${String(basis.id)}` : sql``}
        order by c.id desc limit 1`) : [];
    const eligibleLeads = assistantWritesEnabled(settings) && !developmentReviewEnabled(enterpriseId!)
      && ['lead', 'identity'].includes(String(basis.kind))
      ? await rows<{ id: string }>(tx, sql`select id::text from app.leads
          where enterprise_id=${enterpriseId!} and customer_user_id=${identity.userId}
            and archived_at is null and status<>'closed'
            ${body.leadId ? sql`and id=${String(basis.id)}` : sql``} order by id limit 2`)
      : [];
    const staffProfileLeadId = eligibleLeads.length === 1 &&
      (basis.kind !== 'lead' || eligibleLeads[0].id === basis.id) ? eligibleLeads[0].id : null;
    return { enterprise, settings, reference, resumeConversationId: ids.length ? ids[0].id : null, staffProfileLeadId, acquisition };
  });
  const publicConversationId = await withPlatformTransaction(async tx => {
    const scope = await readPublicAssistantScope(tx);
    return scope ? recentPublicConsultation(tx, scope.enterpriseId, identity.userId) : null;
  });
  const guidance = configuredGuidance(settings?.guidance_config);
  const guidanceVersion = Number(settings?.version || 1);
  const entryToken = await new SignJWT({ enterpriseId, contextVersion: identity.contextVersion,
    basis: { ...basis, ...(staffProfileLeadId ? { staffProfileLeadId } : {}) }, guidanceVersion }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId).setAudience('assistant-entry').setIssuedAt().setExpirationTime('15m').sign(entrySecret());
  return { entryToken, expiresIn: 900, enterprise: acquisition
      ? { id: enterpriseId, name: acquisition.brandName, logo: acquisition.brandLogo }
      : { id: enterpriseId, name: enterprise!.name, logo: enterprise!.logo },
    capabilities: actor.capabilities, resumeConversationId,
    ...(publicConversationId ? { publicConversationId } : {}),
    canSend: assistantWritesEnabled(settings), maxMessageChars: Number(settings?.max_message_chars) || 4000,
    ...(staffProfileLeadId ? { staffProfileCapture: true } : {}),
    ...(acquisition ? { acquisition } : {}),
    guidanceOpening: contentEntry ? contentGreeting(basis.kind==='reference_content'?reference:null) : acquisition?.opening || guidanceOpening(guidance),
    guidanceEnabled: contentEntry ? false : guidance.enabled, guidance: contentEntry ? null : guidanceView({ ...guidance, chatFirst: true }, []),
    ...(contentEntry&&reference&&basis.kind==='reference_content'?{referenceEntry:body.referenceEntry}:{}) };
}
export async function fromEntry(identity: Identity, token: unknown, staffProfileNotice = false) {
  if (typeof token !== 'string' || token.length > 4096) fail('entry_context_invalid', 422);
  const { payload } = await jwtVerify(token, entrySecret(), { audience: 'assistant-entry', algorithms: ['HS256'] })
    .catch(() => fail('entry_context_invalid', 422));
  if (payload.sub !== identity.userId || payload.contextVersion !== identity.contextVersion) fail('entry_context_invalid', 422);
  const enterpriseId = id(payload.enterpriseId), basis = { ...(payload.basis as Record<string, unknown>) };
  if (basis.kind === 'portfolio_content') fail('assistant_share_preview_only', 403);
  if (payload.scope === PUBLIC_ASSISTANT_SCOPE) {
    const scope = await withPlatformTransaction(tx => readPublicAssistantScope(tx));
    if (!scope || scope.enterpriseId !== enterpriseId
      || !scope.config.enabled || Number(payload.publicConfigVersion) !== Number(scope.config.version)
      || basis.scope !== PUBLIC_ASSISTANT_SCOPE) fail('entry_context_invalid', 422);
    if (basis.kind !== 'public_consultation') fail('entry_context_invalid', 422);
    return publicActor(identity, scope, { ...basis, publicConfigVersion: scope.config.version });
  }
  const service = await withPlatformTransaction(tx => currentCustomerService(tx, identity.userId));
  if (service.ambiguous) fail('customer_service_ambiguous', 409);
  if (!service.enterpriseId) fail('assistant_service_code_required', 403);
  if (service.enterpriseId !== enterpriseId) fail('assistant_resource_not_found', 404);
  // A consultation started by an earlier app version keeps its private draft.
  if (!staffProfileNotice) delete basis.staffProfileLeadId;
  if (basis.kind === 'reference_content') {
    return withTenantTransaction(enterpriseId, async tx => {
      const available = await contentEntrySource(tx, basis as ContentEntry);
      if (!available) return actorFor(identity,enterpriseId,{kind:'reference_unavailable',enterpriseId,guidanceVersion:payload.guidanceVersion});
      if(basis.channelCode) {
        try{basis.channel=await contentChannel(tx,enterpriseId,basis.channelCode);}
        catch{return actorFor(identity,enterpriseId,{kind:'reference_unavailable',enterpriseId,guidanceVersion:payload.guidanceVersion});}
      }
      delete basis.channelCode;
      return actorFor(identity, enterpriseId, { ...basis, guidanceVersion: payload.guidanceVersion });
    });
  }
  return actorFor(identity, enterpriseId, { ...basis, guidanceVersion: payload.guidanceVersion });
}
