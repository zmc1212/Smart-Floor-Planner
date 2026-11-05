/** Match actual string values rather than their JSON-escaped representation. */
export function answerVisibleIn(value: unknown, text: string): boolean {
  if (typeof value === 'string') return value.includes(text);
  if (Array.isArray(value)) return value.some(item => answerVisibleIn(item, text));
  if (value && typeof value === 'object') return Object.values(value).some(item => answerVisibleIn(item, text));
  return false;
}
