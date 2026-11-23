import { SignJWT, jwtVerify } from 'jose';
import { fail, id } from '@/lib/assistant/contracts';
import { getJwtSecret } from '@/lib/jwt-secret';

export type PortfolioEntry = { enterpriseId: string; workId: string; versionId: string; authorId: string };
function secret() {
  return getJwtSecret();
}
// A forwarding link identifies published content, never its viewer or consultation.
export async function createPortfolioEntry(entry: PortfolioEntry) {
  const token = await new SignJWT(entry).setProtectedHeader({ alg: 'HS256' }).setAudience('assistant-portfolio-share')
    .setIssuedAt().setExpirationTime('7d').sign(secret());
  return { token, expiresIn: 604800, path: '/packages/assistant/work/work?portfolioEntry=' + encodeURIComponent(token) };
}
export async function readPortfolioEntry(token: unknown): Promise<PortfolioEntry> {
  if (typeof token !== 'string' || token.length > 2048) fail('entry_context_invalid', 422);
  try {
    const { payload: p } = await jwtVerify(token, secret(), { audience: 'assistant-portfolio-share', algorithms: ['HS256'] });
    if (!Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.exp! - p.iat! > 604800 || p.iat! > Date.now() / 1000 + 60) fail('entry_context_invalid', 422);
    return { enterpriseId: id(p.enterpriseId), workId: id(p.workId), versionId: id(p.versionId), authorId: id(p.authorId) };
  } catch { return fail('entry_context_invalid', 422); }
}
