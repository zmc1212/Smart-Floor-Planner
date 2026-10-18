import { fail } from '@/lib/assistant/contracts';

export const CONSTRUCTION_MENU = 'construction-projects';
export const projectStatuses = ['active', 'paused', 'archived'] as const;
export const memberRoles = ['manager', 'designer', 'worker', 'observer'] as const;
export type ConstructionActor = { enterpriseId: string; adminId: string; miniProgramUserId?: string; miniProgramContextVersion?: number };
export function tradesInput(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 10) fail('invalid_construction_trades', 422);
  const trades = value.map(v => text(v, 30));
  if (new Set(trades).size !== trades.length) fail('invalid_construction_trades', 422);
  return trades;
}
export function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail('invalid_construction', 422);
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('invalid_construction', 422);
  return value.trim();
}
export function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('invalid_construction', 422);
  return Number(value);
}
export function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) fail('invalid_construction', 422);
  return value as T;
}
