const PLACEHOLDER_CUSTOMER_NAMES = new Set(['微信客户']);

export function normalizeCustomerPhone(phone: string): string {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (/^86[1][3-9]\d{9}$/.test(digits)) return digits.slice(2);
  if (/^0086[1][3-9]\d{9}$/.test(digits)) return digits.slice(4);
  return digits || String(phone || '').trim();
}

export function customerPhoneLookupValues(phone: string): string[] {
  const trimmed = String(phone || '').trim();
  const normalized = normalizeCustomerPhone(phone);
  const values = new Set<string>();
  if (trimmed) values.add(trimmed);
  if (normalized) values.add(normalized);
  if (/^1[3-9]\d{9}$/.test(normalized)) {
    values.add(`86${normalized}`);
    values.add(`+86${normalized}`);
  }
  return [...values];
}

export function isPlaceholderCustomerName(name?: string | null): boolean {
  return PLACEHOLDER_CUSTOMER_NAMES.has(String(name || '').trim());
}
