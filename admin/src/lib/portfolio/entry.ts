import { SignJWT, jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { workContent } from './contracts';

export type PortfolioEntry = { enterpriseId: string; workId: string; versionId: string; authorId: string };
function secret() {
  if (!process.env.JWT_SECRET) fail('assistant_unavailable', 503);
  return new TextEncoder().encode(process.env.JWT_SECRET);
}
// A forwarding link identifies published content, never its viewer or consultation.
export async function createPortfolioEntry(entry: PortfolioEntry) {
  const token = await new SignJWT(entry).setProtectedHeader({ alg: 'HS256' }).setAudience('assistant-portfolio-share')
    .setIssuedAt().setExpirationTime('7d').sign(secret());
  return { token, expiresIn: 604800, path: '/packages/assistant/designer/designer?portfolioEntry=' + encodeURIComponent(token) };
}
export async function readPortfolioEntry(token: unknown): Promise<PortfolioEntry> {
  if (typeof token !== 'string' || token.length > 2048) fail('entry_context_invalid', 422);
  try {
    const { payload: p } = await jwtVerify(token, secret(), { audience: 'assistant-portfolio-share', algorithms: ['HS256'] });
    if (!Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.exp! - p.iat! > 604800 || p.iat! > Date.now() / 1000 + 60) fail('entry_context_invalid', 422);
    return { enterpriseId: id(p.enterpriseId), workId: id(p.workId), versionId: id(p.versionId), authorId: id(p.authorId) };
  } catch { return fail('entry_context_invalid', 422); }
}
export async function portfolioEntrySource(tx: PostgresTransaction, entry: PortfolioEntry) {
  const row = await one(tx, sql`select v.content,a.display_name from app.portfolio_works w
    join app.portfolio_versions v on v.enterprise_id=w.enterprise_id and v.work_id=w.id and v.id=w.published_version_id and v.status='published'
    join app.admin_users a on a.enterprise_id=w.enterprise_id and a.id=w.author_id and a.role='designer' and a.status='active' and a.must_change_password=false
    where w.enterprise_id=${entry.enterpriseId} and w.id=${entry.workId} and w.published_version_id=${entry.versionId}
      and w.author_id=${entry.authorId} and w.kind='designer_work' and not w.withdrawn for share of w,v,a`);
  if (!row) return null;
  try {
    const content = workContent(row.content, true);
    return content.showOnProfile ? { title: content.title, authorName: String(row.display_name || '设计师') } : null;
  } catch { return null; }
}
