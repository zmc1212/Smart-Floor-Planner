import fs from 'node:fs';
import { fail } from '../../contracts';

/** Openings are a family of one-shot, tool-free generations. Each scene gets
 * its own FastGPT app so that editing one opening's prompt cannot change
 * another scene, and output limits stay per scene. */
export const openingsProtocol = 'xiaok-openings-v1';
export type OpeningConstraints = { minChars: number; maxChars: number; noUrl: boolean;
  noCitationMarkers: boolean; noPhotoClaims: boolean; noCommitments: boolean };
export type OpeningScene = { key: string; appId: string; audience: 'customer';
  input: readonly string[]; constraints: OpeningConstraints };
export type EnterpriseOpenings = { enterpriseId: string; scenes: Record<string, OpeningScene> };
export type Openings = { protocol: typeof openingsProtocol; enterprises: EnterpriseOpenings[] };

const inputVocabulary = new Set(['name', 'cityName', 'cityCode', 'district', 'stageName', 'excerpts', 'photoCount', 'designerName']);
const sceneKeyPattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,2}$/;

/** `site.public` keeps the existing purpose so queued and historical runs stay
 * readable; later scenes get `intro.<scene>`. */
export const purposeForOpening = (scene: string) => scene === 'site.public' ? 'public.site.intro' : 'intro.' + scene;
export const sceneForOpeningPurpose = (purpose: string) => purpose === 'public.site.intro' ? 'site.public'
  : purpose.startsWith('intro.') && sceneKeyPattern.test(purpose.slice(6)) ? purpose.slice(6) : undefined;

export function parseOpenings(value: unknown): Openings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('context_changed');
  const root = value as Record<string, unknown>;
  // A single enterprise keeps the historical object shape; a deployment with
  // several enterprises lists them explicitly.
  const entries = Array.isArray(root.enterprises) ? root.enterprises
    : [{ enterpriseId: root.enterpriseId, scenes: root.scenes }];
  if (Object.keys(root).some(key => !['protocol', 'enterpriseId', 'scenes', 'enterprises'].includes(key))
    || root.protocol !== openingsProtocol || !entries.length || entries.length > 50) fail('context_changed');
  const enterprises: EnterpriseOpenings[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('context_changed');
    const registry = entry as Record<string, unknown>;
    if (Object.keys(registry).some(key => !['enterpriseId', 'scenes'].includes(key))
      || typeof registry.enterpriseId !== 'string' || !/^[1-9]\d{0,18}$/.test(registry.enterpriseId)
      || !registry.scenes || typeof registry.scenes !== 'object' || Array.isArray(registry.scenes)) fail('context_changed');
    const scenes = parseScenes(registry.scenes as Record<string, unknown>);
    if (enterprises.some(existing => existing.enterpriseId === registry.enterpriseId)) fail('context_changed');
    enterprises.push({ enterpriseId: registry.enterpriseId, scenes });
  }
  return { protocol: openingsProtocol, enterprises };
}
function parseScenes(rawScenes: Record<string, unknown>) {
  const entries = Object.entries(rawScenes);
  if (!entries.length || entries.length > 12) fail('context_changed');
  const scenes: Record<string, OpeningScene> = {};
  for (const [key, raw] of entries) {
    if (!sceneKeyPattern.test(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) fail('context_changed');
    const scene = raw as Record<string, unknown>;
    if (Object.keys(scene).some(field => !['appId', 'audience', 'input', 'constraints'].includes(field))
      || typeof scene.appId !== 'string' || !/^[a-f0-9]{24}$/.test(scene.appId)) fail('context_changed');
    // Staff audiences need the admin principal/capability model that the V2
    // authorization does not implement yet, so they fail closed here.
    if (scene.audience !== 'customer') fail('context_changed');
    if (!Array.isArray(scene.input) || !scene.input.length || scene.input.length > 8
      || new Set(scene.input).size !== scene.input.length
      || scene.input.some(field => typeof field !== 'string' || !inputVocabulary.has(field))) fail('context_changed');
    const rawConstraints = (scene.constraints ?? {}) as Record<string, unknown>;
    if (typeof rawConstraints !== 'object' || Array.isArray(rawConstraints)
      || Object.keys(rawConstraints).some(flag => !['minChars', 'maxChars', 'noUrl', 'noCitationMarkers', 'noPhotoClaims', 'noCommitments'].includes(flag))) fail('context_changed');
    const minChars = rawConstraints.minChars ?? 8, maxChars = rawConstraints.maxChars ?? 140;
    if (!Number.isSafeInteger(minChars) || !Number.isSafeInteger(maxChars)
      || Number(minChars) < 1 || Number(maxChars) > 300 || Number(minChars) >= Number(maxChars)) fail('context_changed');
    for (const flag of ['noUrl', 'noCitationMarkers', 'noPhotoClaims', 'noCommitments'])
      if (rawConstraints[flag] !== undefined && typeof rawConstraints[flag] !== 'boolean') fail('context_changed');
    scenes[key] = { key, appId: scene.appId, audience: 'customer', input: scene.input as string[],
      constraints: { minChars: Number(minChars), maxChars: Number(maxChars),
        noUrl: rawConstraints.noUrl !== false, noCitationMarkers: rawConstraints.noCitationMarkers !== false,
        noPhotoClaims: rawConstraints.noPhotoClaims !== false, noCommitments: rawConstraints.noCommitments !== false } };
  }
  return scenes;
}

/** A missing or malformed registry disables openings instead of blocking the
 * customer's entry; the run itself still fails closed when the scene is gone. */
export function openingScene(enterpriseId: string, scene: string): OpeningScene | undefined {
  const file = process.env.XIAOK_OPENINGS_FILE;
  if (!file) return;
  try {
    const parsed = parseOpenings(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.enterprises.find(enterprise => enterprise.enterpriseId === enterpriseId)?.scenes[scene];
  } catch { return; }
}
