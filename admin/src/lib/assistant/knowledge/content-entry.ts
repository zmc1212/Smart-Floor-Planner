import { compactVerify, SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id } from '../contracts';
import { ReferrerNetworkRepository } from '@/db/repositories/referrer-network-repository';
import { sourceReady } from './sources';

function secret() { if (!process.env.JWT_SECRET) fail('assistant_unavailable',503); return new TextEncoder().encode(process.env.JWT_SECRET); }
/** Share tokens contain only published source identifiers, never a customer or conversation. */
export async function contentChannel(tx:PostgresTransaction,enterpriseId:string,code:unknown) {
  if(code==null)return {kind:'company',enterpriseId};
  if(typeof code!=='string'||!/^(?:sa_|rp_)[A-Za-z0-9_-]{32}$/.test(code))fail('entry_context_invalid',422);
  const repo=new ReferrerNetworkRepository(tx);
  const result=code.startsWith('sa_')?await repo.resolveStaffActivityToken({token:code}):await repo.resolvePromotionToken({token:code});
  if(result.result!=='ok'||!result.code||String(result.code.enterpriseId)!==enterpriseId)fail('entry_context_invalid',422);
  return {kind:code.startsWith('sa_')?'staff_activity_code':'promotion_code',id:String(result.code.id)};
}
export async function createContentEntry(enterpriseId:string, document:Row, version:Row,channelCode?:string) {
  const token = await new SignJWT({enterpriseId,documentId:String(document.id),versionId:String(version.id),hash:String(version.content_hash),...(channelCode?{channelCode}:{})})
    .setProtectedHeader({alg:'HS256'}).setAudience('assistant-reference-share').setIssuedAt().setExpirationTime('7d').sign(secret());
  return { path:'/packages/assistant/chat/chat?referenceEntry='+encodeURIComponent(token), expiresIn:604800 };
}
export type ContentEntry = {enterpriseId:string;documentId:string;versionId:string;hash:string;expired:boolean;channelCode?:string};
export async function readContentEntry(token:unknown):Promise<ContentEntry> {
  if(typeof token!=='string'||token.length>2048)fail('entry_context_invalid',422);
  try {
    // Verify the signature even for expired entries. An expired signed source may
    // identify its enterprise for a safe chat fallback, never authorize the case.
    const verified=await compactVerify(token,secret(),{algorithms:['HS256']});
    const p=JSON.parse(new TextDecoder().decode(verified.payload));
    if(p.aud!=='assistant-reference-share'||typeof p.hash!=='string'||!/^[a-f0-9]{64}$/.test(p.hash)||!Number.isInteger(p.exp)||!Number.isInteger(p.iat)||p.exp-p.iat>604800||p.iat>Date.now()/1000+60)fail('entry_context_invalid',422);
    if(p.channelCode!==undefined&&(typeof p.channelCode!=='string'||!/^(?:sa_|rp_)[A-Za-z0-9_-]{32}$/.test(p.channelCode)))fail('entry_context_invalid',422);
    return {enterpriseId:id(p.enterpriseId),documentId:id(p.documentId),versionId:id(p.versionId),hash:p.hash,expired:p.exp<=Date.now()/1000,...(p.channelCode?{channelCode:p.channelCode}:{})};
  } catch { return fail('entry_context_invalid',422); }
}
export function contentGreeting(source:Row|null|undefined) {return source?`你是从「${String(source.title)}」进来的。${String(source.body)}\n仅供方向参考，可以直接说想法，也可以随时找设计师。`:'这个案例分享已失效，你仍可在这里继续装修咨询，或找设计师。';}
export async function contentEntrySource(tx:PostgresTransaction, entry:ContentEntry) {
  if(entry.expired)return null;
  return one(tx,sql`select d.title,d.id as document_id,d.status,d.audience,v.id as document_version_id,v.body,v.effective_from,v.effective_to,c.id as chunk_id,c.text_hash
    from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.document_id=d.id
    join app.assistant_knowledge_chunks c on c.enterprise_id=v.enterprise_id and c.document_version_id=v.id and c.ordinal=0
    join app.assistant_enterprise_settings s on s.enterprise_id=d.enterprise_id
    join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
    where d.enterprise_id=${entry.enterpriseId} and d.id=${entry.documentId} and v.id=${entry.versionId} and d.published_version_id=v.id
    and d.source_type='reference_case' and d.audience='customer_public' and d.status='active' and v.published_at is not null
    and v.content_hash=${entry.hash} and v.reference_case is not null and v.index_status='ready' and v.indexed_hash=v.content_hash
    and ${sourceReady}`);
}
