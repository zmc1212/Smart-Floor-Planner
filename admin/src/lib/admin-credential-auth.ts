import bcrypt from 'bcryptjs';
import type {
  AdminUserRecord,
  AdminUserRepository,
} from '@/db/repositories';

export type AdminCredentialResult =
  | { kind: 'ok'; admin: AdminUserRecord }
  | { kind: 'invalid_credentials' }
  | { kind: 'ambiguous_identifier' };

export async function authenticateAdminCredential(
  repository: AdminUserRepository,
  identifier: string,
  password: string
): Promise<AdminCredentialResult> {
  const candidates = await repository.listByUsernameOrPhone(
    identifier.trim(),
    true
  );
  const matches: AdminUserRecord[] = [];
  for (const candidate of candidates) {
    if (await bcrypt.compare(password, candidate.passwordHash)) {
      matches.push(candidate);
    }
  }
  if (matches.length === 0) return { kind: 'invalid_credentials' };
  if (matches.length > 1) return { kind: 'ambiguous_identifier' };
  return { kind: 'ok', admin: matches[0] };
}
