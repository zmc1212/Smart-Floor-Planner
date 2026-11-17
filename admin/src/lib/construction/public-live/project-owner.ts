import { sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { getJwtSecret } from '@/lib/jwt-secret';
import { PublicLiveCustomer } from './customer';
import { publicLiveUrl } from './media';

type OwnerIdentity = { userId: string; contextVersion: number };
type OwnerApplication = OwnerIdentity & {
  enterpriseId: string;
  projectId: string;
  liveId: string;
  versionId: string;
  conversationId: string;
};

const audience = 'construction-owner-live-webview';
const expiresInSeconds = 600;

async function locateOwnerApplication(identity: OwnerIdentity, projectId: string): Promise<OwnerApplication | null> {
  const uid = id(identity.userId);
  const pid = id(projectId);
  // Locate IDs only. The tenant service rechecks the owner, live consultation,
  // current source and version under the same locks as the existing decisions.
  const entry = await withPlatformTransaction(tx => one(tx, sql`
    select p.enterprise_id, l.id, l.current_version_id, l.conversation_id
    from app.construction_projects p
    join app.leads lead on lead.enterprise_id=p.enterprise_id and lead.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id
    left join app.construction_public_live l on l.enterprise_id=p.enterprise_id and l.project_id=p.id
      and l.customer_id=${uid} and l.status<>'draft'
    where p.id=${pid} and p.status='active' and p.customer_access and e.status='active'
      and lead.customer_user_id=${uid} and lead.archived_at is null and lead.status<>'closed'`));
  if (!entry) fail('public_live_unavailable', 404);
  if (!entry.id || !entry.current_version_id || !entry.conversation_id) return null;
  return { ...identity, projectId: pid, enterpriseId: String(entry.enterprise_id), liveId: String(entry.id),
    versionId: String(entry.current_version_id), conversationId: String(entry.conversation_id) };
}

export function ownerApplicationService(application: OwnerApplication) {
  const actor: ActorContext = {
    enterpriseId: application.enterpriseId,
    principal: { kind: 'user', userId: application.userId },
    contextVersion: application.contextVersion,
    capabilities: ['assistant.chat.self'],
  };
  return new PublicLiveCustomer(actor, application.conversationId, application.projectId);
}

export async function readOwnerApplication(application: OwnerApplication) {
  const { items } = await ownerApplicationService(application).read(application.liveId, application.versionId);
  const item = items[0];
  if (!item) fail('public_live_unavailable', 404);
  // Keep the public locator and internal message ID off the authorization page.
  const { id, projectName, alias, versionId, revision, status, statusLabel, available,
    reason, cover, canDecide, canWithdraw, playbackReady, wasPublished } = item;
  const label = !available && ['pending_owner', 'owner_approved', 'published'].includes(status)
    ? '直播申请当前不可用' : status === 'withdrawn' && !wasPublished ? '已撤回直播申请' : statusLabel;
  return { id, projectName, alias, versionId, revision, status,
    statusLabel: label, available, reason, cover, canDecide, canWithdraw, playbackReady };
}

export async function ownerApplicationSummary(identity: OwnerIdentity, projectId: string) {
  const application = await locateOwnerApplication(identity, projectId);
  if (!application) return { item: null };
  const { id, alias, versionId, status, statusLabel, canDecide } = await readOwnerApplication(application);
  return { item: { id, alias, versionId, status, statusLabel, canDecide } };
}

export async function issueOwnerLiveWebTicket(identity: OwnerIdentity, projectId: string, liveId: string, versionId: string) {
  const application = await locateOwnerApplication(identity, projectId);
  if (!application || application.liveId !== id(liveId) || application.versionId !== id(versionId))
    fail('public_live_unavailable', 404);
  await readOwnerApplication(application);
  // This audience is accepted only on the dedicated WebView API. In particular
  // neither the Mini Program bearer nor the media receipt token can write here.
  const ticket = await new SignJWT(application)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getJwtSecret());
  return { url: publicLiveUrl('/construction-camera/live-authorization#access=' + ticket), expiresInSeconds };
}

export async function readOwnerLiveWebTicket(request: Request): Promise<OwnerApplication> {
  const bearer = request.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ') || bearer.length > 2048) fail('public_live_forbidden', 401);
  try {
    const { payload } = await jwtVerify(bearer.slice(7), getJwtSecret(), { audience, algorithms: ['HS256'], maxTokenAge: expiresInSeconds });
    if (typeof payload.contextVersion !== 'number' || !Number.isSafeInteger(payload.contextVersion) || payload.contextVersion < 0)
      fail('public_live_forbidden', 401);
    return {
      enterpriseId: id(payload.enterpriseId), projectId: id(payload.projectId), userId: id(payload.userId),
      liveId: id(payload.liveId), versionId: id(payload.versionId), conversationId: id(payload.conversationId),
      contextVersion: payload.contextVersion,
    };
  } catch {
    fail('public_live_forbidden', 401);
  }
}
