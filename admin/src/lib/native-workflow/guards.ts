import type { ValueType } from './types';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
