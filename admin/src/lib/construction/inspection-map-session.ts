import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { getJwtSecret } from '@/lib/jwt-secret';
import { fail } from '@/lib/assistant/contracts';
import { object, type ConstructionActor } from './contracts';
import { inspectionPoint, type InspectionPoint } from './inspection-policy';
import { inspectionStops } from './inspection';

const audience = 'construction-inspection-map';
const mapSecret = () => createHash('sha256').update(getJwtSecret()).update(audience).digest();
type MapSession = { actor: ConstructionActor; origin: InspectionPoint | null };

export async function createInspectionMapSession(actor: ConstructionActor, input: unknown) {
  const value = object(input, ['origin']);
  const origin = value.origin == null ? null : inspectionPoint(value.origin);
  await inspectionStops(actor);
  const ticket = await new EncryptJWT({ actor, origin })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setAudience(audience).setIssuedAt().setExpirationTime('15m').encrypt(mapSecret());
  return { ticket };
}

export async function verifyInspectionMapSession(request: Request): Promise<MapSession> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]{1,4096})$/)?.[1];
  if (!token) fail('Unauthorized', 401);
  try {
    const { payload } = await jwtDecrypt(token, mapSecret(), { audience, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] });
    const actor = payload.actor as ConstructionActor;
    if (!actor?.miniProgramUserId || !Number.isSafeInteger(actor.miniProgramContextVersion)) fail('Unauthorized', 401);
    return { actor, origin: payload.origin as InspectionPoint | null };
  } catch { return fail('Unauthorized', 401); }
}

export function inspectionBrowserKey() {
  const key = String(process.env.TIANDITU_INSPECTION_BROWSER_KEY || '').trim();
  return /^[a-fA-F0-9]{32}$/.test(key) ? key : null;
}
