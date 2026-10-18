import { SignJWT, jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows } from '@/db/repositories/assistant-repository';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { ReferrerNetworkRepository } from '@/db/repositories/referrer-network-repository';
import { fail, id, type ActorContext } from '../contracts';
import { configuredGuidance, guidanceOpening, guidanceView } from '../requirements/guidance';
import { readContentEntry, contentEntrySource, contentChannel, contentGreeting, type ContentEntry } from '../knowledge/content-entry';
import { readPortfolioEntry, portfolioEntrySource, type PortfolioEntry } from '@/lib/portfolio/entry';

export async function customerIdentity(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) fail('identity_context_invalid', 401);
  const payload = await verifyMiniProgramToken(request.headers.get('authorization')?.slice(7) || '');
  if (!payload || !context.user.openid) fail('identity_context_invalid', 401);
  if (context.mode !== 'customer') fail('assistant_capability_forbidden', 403);
  return { userId: context.user._id, contextVersion: payload.contextVersion, enterpriseId: context.enterpriseId };
}
type Identity = Awaited<ReturnType<typeof customerIdentity>>;
export function actorFor(identity: Identity, enterpriseId: string, entry?: Record<string, unknown>): ActorContext {
  return { enterpriseId, principal: { kind: 'user', userId: identity.userId }, contextVersion: identity.contextVersion, capabilities: ['assistant.chat.self'], entry };
}
function entrySecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) fail('model_unavailable', 503);
  return new TextEncoder().encode(secret);
}
/** Platform locator returns IDs only, never conversation/message/knowledge bodies. */
export async function locate(identity: Identity, kind: 'conversation' | 'run' | 'citation', targetId: string) {
  id(targetId);
  const found = await withPlatformTransaction(tx => one(tx, sql`select c.enterprise_id,c.id from app.assistant_conversations c
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
    ${kind === 'run' ? sql`join app.assistant_runs r on r.enterprise_id=c.enterprise_id and r.conversation_id=c.id` : sql``}
    ${kind === 'citation' ? sql`join app.assistant_message_citations x on x.enterprise_id=c.enterprise_id and x.conversation_id=c.id` : sql``}
    where ${kind === 'run' ? sql`r.id` : kind==='citation'?sql`x.id`:sql`c.id`}=${targetId} and p.user_id=${identity.userId} and p.status='active' and c.purpose='customer_consultation'`));
  if (!found) fail('assistant_resource_not_found', 404);
  return actorFor(identity, String(found.enterprise_id));
}
export async function entryContext(identity: Identity, body: Record<string, unknown>) {
  const fields = ['entryCode', 'leadId', 'conversationId','referenceEntry', 'portfolioEntry', 'publicEnterpriseId'].filter(k => body[k] !== undefined);
  if (fields.length > 1 || Object.keys(body).some(k => !fields.includes(k))) fail('entry_context_invalid', 422);
  let enterpriseId = identity.enterpriseId;
  let basis: Record<string, unknown> = { kind: 'identity' };
  let contentEntry:ContentEntry|null=null;
  let portfolioEntry: PortfolioEntry | null = null;
  if (body.publicEnterpriseId) {
    enterpriseId = id(body.publicEnterpriseId); basis = { kind: 'public_site_entry' };
  } else if (body.portfolioEntry) {
    portfolioEntry = await readPortfolioEntry(body.portfolioEntry); enterpriseId = portfolioEntry.enterpriseId;
    basis = { kind: 'portfolio_content', ...portfolioEntry };
  } else if (body.referenceEntry) {
    contentEntry=await readContentEntry(body.referenceEntry);enterpriseId=contentEntry.enterpriseId;
    basis={kind:'reference_content',...contentEntry};
  } else if (body.conversationId) {
    const actor = await locate(identity, 'conversation', id(body.conversationId));
    enterpriseId = actor.enterpriseId; basis = { kind: 'conversation', id: body.conversationId };
  } else if (body.leadId) {
    const lead = await withPlatformTransaction(tx => one(tx, sql`select id,enterprise_id from app.leads where id=${id(body.leadId)}
      and customer_user_id=${identity.userId} and archived_at is null`));
    if (!lead?.enterprise_id) fail('entry_context_invalid', 422);
    enterpriseId = String(lead.enterprise_id); basis = { kind: 'lead', id: String(lead.id) };
  } else if (body.entryCode) {
    if (typeof body.entryCode !== 'string' || !/^(rp_|sa_)?[A-Za-z0-9_-]{32}$/.test(body.entryCode)) fail('entry_context_invalid', 422);
    const token = body.entryCode;
    const resolved = await withPlatformTransaction(async tx => {
      const repository = new ReferrerNetworkRepository(tx);
      const candidates = token.length === 32 ? ['rp_' + token, 'sa_' + token] : [token];
      for (const candidate of candidates) {
        if (candidate.startsWith('rp_')) {
          const result = await repository.resolvePromotionToken({ token: candidate });
          if (result.result === 'ok' && result.code) return { enterpriseId: String(result.code.enterpriseId), kind: 'promotion_code', id: String(result.code.id) };
        } else {
          const result = await repository.resolveStaffActivityToken({ token: candidate });
          if (result.result === 'ok' && result.code) return { enterpriseId: String(result.code.enterpriseId), kind: 'staff_activity_code', id: String(result.code.id) };
        }
      }
      return null;
    });
    if (!resolved) fail('entry_context_invalid', 422);
    enterpriseId = resolved.enterpriseId; basis = { kind: resolved.kind, id: resolved.id };
  }
  if (!enterpriseId) fail('entry_context_invalid', 422);
  const actor = actorFor(identity, enterpriseId, basis);
  const { enterprise, settings, reference, resumeConversationId } = await withTenantTransaction(enterpriseId, async tx => {
    const settings = await new AssistantRepository(tx, actor).settings();
    const enterprise = await one(tx, sql`select id,name,logo from app.enterprises where id=${enterpriseId!}`);
    if (portfolioEntry && !await portfolioEntrySource(tx, portfolioEntry)) fail('portfolio_not_found', 404);
    const reference=contentEntry?await contentEntrySource(tx,contentEntry):null;
    if(contentEntry&&!reference)basis={kind:'reference_unavailable',enterpriseId};
    else if(contentEntry){
      try{basis.channel=await contentChannel(tx,enterpriseId!,contentEntry.channelCode);}catch{basis={kind:'reference_unavailable',enterpriseId};}
    }
    // A public company entry conveys no project/customer grant. Resume only the
    // visitor's own unambiguous open consultation; otherwise leave history choice explicit.
    const ids = body.publicEnterpriseId ? await rows<{id:string}>(tx, sql`select c.id::text from app.assistant_conversations c
      join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id
      where c.enterprise_id=${enterpriseId!} and c.purpose='customer_consultation' and c.status='open'
        and p.user_id=${identity.userId} and p.status='active' order by c.id desc limit 2`) : [];
    return { enterprise, settings, reference, resumeConversationId: ids.length === 1 ? ids[0].id : null };
  });
  const guidance = configuredGuidance(settings?.guidance_config);
  const guidanceVersion = Number(settings?.version || 1);
  const entryToken = await new SignJWT({ enterpriseId, contextVersion: identity.contextVersion, basis, guidanceVersion }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId).setAudience('assistant-entry').setIssuedAt().setExpirationTime('15m').sign(entrySecret());
  return { entryToken, expiresIn: 900, enterprise: { id: enterpriseId, name: enterprise!.name, logo: enterprise!.logo }, capabilities: actor.capabilities, resumeConversationId,
    canSend: assistantWritesEnabled(settings), maxMessageChars: Number(settings?.max_message_chars) || 4000,
    guidanceOpening: contentEntry ? contentGreeting(basis.kind==='reference_content'?reference:null) : guidanceOpening(guidance),
    guidanceEnabled: contentEntry || portfolioEntry ? false : guidance.enabled, guidance: contentEntry || portfolioEntry ? null : guidanceView({ ...guidance, chatFirst: true }, []),
    ...(portfolioEntry ? { portfolio: portfolioEntry } : {}),
    ...(contentEntry&&reference&&basis.kind==='reference_content'?{referenceEntry:body.referenceEntry}:{}) };
}
export async function fromEntry(identity: Identity, token: unknown) {
  if (typeof token !== 'string' || token.length > 4096) fail('entry_context_invalid', 422);
  try {
    const { payload } = await jwtVerify(token, entrySecret(), { audience: 'assistant-entry', algorithms: ['HS256'] });
    if (payload.sub !== identity.userId || payload.contextVersion !== identity.contextVersion) fail('entry_context_invalid', 422);
    const enterpriseId=id(payload.enterpriseId),basis={...(payload.basis as Record<string,unknown>)};
    if (basis.kind === 'portfolio_content' && !await withTenantTransaction(enterpriseId, tx => portfolioEntrySource(tx, basis as PortfolioEntry))) fail('entry_context_invalid', 422);
    if(basis.kind==='reference_content'){
      const available=await withTenantTransaction(enterpriseId,tx=>contentEntrySource(tx,basis as ContentEntry));
      if(!available)return actorFor(identity,enterpriseId,{kind:'reference_unavailable',enterpriseId,guidanceVersion:payload.guidanceVersion});
      if(basis.channelCode) {
        try{basis.channel=await withTenantTransaction(enterpriseId,tx=>contentChannel(tx,enterpriseId,basis.channelCode));}
        catch{return actorFor(identity,enterpriseId,{kind:'reference_unavailable',enterpriseId,guidanceVersion:payload.guidanceVersion});}
      }
      delete basis.channelCode;
    }
    return actorFor(identity, enterpriseId, { ...basis, guidanceVersion: payload.guidanceVersion });
  } catch { fail('entry_context_invalid', 422); }
}
