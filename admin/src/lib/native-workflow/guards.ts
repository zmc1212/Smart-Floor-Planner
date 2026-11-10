import { WORKFLOW_BOUNDS, type ValueType } from './types';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict JSON object: excludes Date, Map, Set and class instances. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type JsonValueInspection =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly path: string };

/**
 * Validates that a value can cross the observation boundary as JSON. Cycles,
 * non-JSON objects, non-finite numbers and excessive depth/size are rejected
 * before any deep clone runs, so callers never overflow the stack.
 */
export function inspectJsonValue(
  value: unknown,
  options?: { readonly maxDepth?: number; readonly maxNodes?: number },
): JsonValueInspection {
  const maxDepth = options?.maxDepth ?? WORKFLOW_BOUNDS.maxObservationDepth;
  const maxNodes = options?.maxNodes ?? WORKFLOW_BOUNDS.maxObservationNodes;
  let count = 0;
  const stack = new WeakSet<object>();

  const visit = (current: unknown, depth: number, path: string): JsonValueInspection => {
    count += 1;
    if (count > maxNodes) return { ok: false, reason: 'too_large', path };
    if (depth > maxDepth) return { ok: false, reason: 'too_deep', path };
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return { ok: true };
    if (typeof current === 'number') {
      return Number.isFinite(current) ? { ok: true } : { ok: false, reason: 'non_finite_number', path };
    }
    if (typeof current !== 'object') return { ok: false, reason: 'unsupported_type', path };
    const container: object = current;
    if (stack.has(container)) return { ok: false, reason: 'cyclic', path };
    stack.add(container);
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const result = visit(current[index], depth + 1, `${path}[${index}]`);
        if (!result.ok) {
          stack.delete(container);
          return result;
        }
      }
      stack.delete(container);
      return { ok: true };
    }
    if (!isJsonObject(current)) {
      stack.delete(container);
      return { ok: false, reason: 'unsupported_type', path };
    }
    for (const key of Object.keys(current)) {
      const result = visit(current[key], depth + 1, `${path}.${key}`);
      if (!result.ok) {
        stack.delete(container);
        return result;
      }
    }
    stack.delete(container);
    return { ok: true };
  };

  return visit(value, 0, '$');
}

export function isJsonScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** Own-property checks only; inherited members such as `constructor` are not contract entries. */
export function hasOwn(record: object | null | undefined, key: string): boolean {
  return record !== null && record !== undefined && Object.prototype.hasOwnProperty.call(record, key);
}

export function ownValue<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  if (!record || !hasOwn(record, key)) return undefined;
  return record[key];
}

/** JSON value copy used at observation, state and pending-operation boundaries. */
export function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item)) as unknown as T;
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) result[key] = cloneJsonValue(value[key]);
    return result as T;
  }
  return value;
}

export function valueMatchesType(value: unknown, type: ValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string_list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'object_list':
      return Array.isArray(value) && value.every((item) => isPlainObject(item));
    case 'object':
      return isPlainObject(value);
  }
}

export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value) as T;
  }
  return value;
}
