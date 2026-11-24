import { sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { fail, fingerprint } from '@/lib/assistant/contracts';
import { getJwtSecret } from '@/lib/jwt-secret';
import { object, text, type ConstructionActor } from './contracts';
import type { Row } from '@/db/repositories/assistant-repository';
import type { ConstructionStage } from './stages';

export type InspectionPoint = { latitude: number; longitude: number };
export type InspectionPin = InspectionPoint & { coordinateSystem: 'wgs84'; revision: number; name: string };
export const inspectionModes = ['onsite', 'remote', 'manual'] as const;
export type InspectionMode = typeof inspectionModes[number] | 'required';
export type InspectionSuggestion = {
  mode: typeof inspectionModes[number]; reason: string; priority: boolean;
  mediaIds: string[]; speechId: string | null;
};

export function checkpointSelection(input: unknown, stages: ConstructionStage[], selected: { key: string }[]) {
  if (input === undefined) return null;
  const v = object(input, ['stageKey', 'key']);
  const stage = stages.find(s => s.key === v.stageKey && selected.some(item => item.key === s.key));
  const item = stage?.inspectionCheckpoints?.find(checkpoint => checkpoint.key === v.key);
  if (!stage || !item) fail('inspection_checkpoint_changed', 409);
  return { stageKey: stage.key, key: item.key, name: item.name };
}

export function inspectionPoint(input: unknown): InspectionPoint {
  const v = object(input, ['latitude', 'longitude', 'coordinateSystem']);
  if (v.coordinateSystem !== 'wgs84' || typeof v.latitude !== 'number' || typeof v.longitude !== 'number'
    || !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude) || Math.abs(v.latitude) > 90
    || Math.abs(v.longitude) > 180) fail('inspection_invalid_point', 422);
  return { latitude: v.latitude, longitude: v.longitude };
}

export function readInspectionSuggestion(value: unknown, evidence: Pick<InspectionSuggestion, 'mediaIds' | 'speechId'>): InspectionSuggestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Row, mode = inspectionModes.find(item => item === v.mode);
  if (!mode || typeof v.priority !== 'boolean' || typeof v.reason !== 'string'
    || !v.reason.trim() || v.reason.length > 180) return null;
  return { mode, reason: v.reason.trim(), priority: v.priority, ...evidence };
}

/** The query aliases the record as r. A withdrawn original cannot support the suggestion. */
export const inspectionEvidenceAvailable = sql`not exists (
  select 1 from jsonb_array_elements_text(coalesce(r.inspection_suggestion->'mediaIds', '[]'::jsonb)) as evidence(id)
  where not exists (select 1 from app.construction_site_attachments x join app.construction_site_media m
    on m.enterprise_id=x.enterprise_id and m.project_id=x.project_id and m.id=x.media_id
    where x.enterprise_id=r.enterprise_id and x.project_id=r.project_id and x.record_id=r.id
      and m.id::text=evidence.id and m.deleted_at is null)
) and (r.inspection_suggestion->>'speechId' is null or exists (
  select 1 from app.assistant_speech_assets s where s.enterprise_id=r.enterprise_id and s.project_id=r.project_id
    and s.conversation_id=r.conversation_id and s.message_id=r.source_message_id and s.deleted_at is null
    and s.id::text=r.inspection_suggestion->>'speechId'
))`;

export const inspectionModeSql = sql`case when r.inspection_checkpoint is not null then 'required'
  when r.inspection_decision is not null then r.inspection_decision->>'mode'
  when r.inspection_suggestion is not null and (${inspectionEvidenceAvailable}) then r.inspection_suggestion->>'mode'
  else 'manual' end`;

export function inspectionProjection(record: Row) {
  const checkpoint = record.inspection_checkpoint as { name: string } | null;
  const decision = record.inspection_decision as { mode: 'onsite' | 'remote'; reason: string } | null;
  const suggestion = record.inspection_evidence_available ? record.inspection_suggestion as InspectionSuggestion | null : null;
  const mode: InspectionMode = checkpoint ? 'required' : decision?.mode || suggestion?.mode || 'manual';
  return { mode, reason: checkpoint?.name || decision?.reason || suggestion?.reason || '',
    priority: suggestion?.priority === true, source: (checkpoint ? 'rule' : decision ? 'staff' : suggestion ? 'ai' : 'pending'),
    requiresOnsite: mode === 'required' || mode === 'onsite' };
}

export function inspectionDistance(a: InspectionPoint, b: InspectionPoint) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const checkInAudience = 'construction-inspection-check-in';
const checkInScope = (actor: ConstructionActor, record: Row, pin: InspectionPin) => fingerprint({
  actor, projectId: String(record.project_id), recordId: String(record.id), version: Number(record.version), pinRevision: pin.revision,
});

export async function mintInspectionProof(actor: ConstructionActor, record: Row, pin: InspectionPin, fix: InspectionPoint, accuracy: unknown) {
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 50) fail('inspection_location_accuracy', 422);
  if (inspectionDistance(fix, pin) > 200) fail('inspection_location_outside', 422);
  const token = await new SignJWT({ scope: checkInScope(actor, record, pin) })
    .setProtectedHeader({ alg: 'HS256' }).setAudience(checkInAudience).setIssuedAt().setExpirationTime('120s').sign(getJwtSecret());
  return { token, expiresInSeconds: 120 };
}

export async function inspectionReceipt(actor: ConstructionActor, record: Row, pin: InspectionPin | null, input: unknown) {
  const details = inspectionProjection(record);
  if (!details.requiresOnsite) {
    if (input !== undefined) fail('inspection_context_changed', 409);
    return null;
  }
  if (!pin) fail('inspection_pin_missing', 422);
  if (input === undefined) fail('inspection_proof_required', 422);
  const value = object(input, ['token', 'note']);
  const note = text(value.note, 500), token = text(value.token, 2048);
  let proof;
  try {
    proof = (await jwtVerify(token, getJwtSecret(), { audience: checkInAudience, algorithms: ['HS256'], maxTokenAge: '120s' })).payload;
  } catch { return fail('inspection_proof_expired', 422); }
  if (proof.scope !== checkInScope(actor, record, pin) || typeof proof.iat !== 'number') fail('inspection_context_changed', 409);
  return { note, verifiedAt: new Date(proof.iat * 1000).toISOString(), pinRevision: pin.revision, reviewerId: actor.adminId };
}
