import dns from 'node:dns/promises';
import net from 'node:net';

export const MAX_IMAGE_PROXY_BYTES = 20 * 1024 * 1024;

const IMAGE_CONTENT_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function isPrivateIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224;
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return Boolean(mappedIpv4 && isPrivateIpv4(mappedIpv4[1]));
}

export function isPrivateAddress(address: string) {
  const family = net.isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : true;
}

export async function assertSafeRemoteImageUrl(rawUrl: string) {
  if (rawUrl.length > 2048) throw new Error('Image URL is too long');
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
  if (parsed.username || parsed.password) throw new Error('Image URL credentials are not allowed');

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
    throw new Error('Private image host is not allowed');
  }

  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Private image host is not allowed');
  return parsed;
}

export function assertAllowedImageContentType(contentType: string | null) {
  const normalized = contentType?.split(';', 1)[0].trim().toLowerCase() || '';
  if (!IMAGE_CONTENT_TYPES.has(normalized)) throw new Error('Upstream response is not an allowed image');
  return normalized;
}

export async function readBoundedImageBody(response: Response) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_IMAGE_PROXY_BYTES) throw new Error('Image response is too large');
  if (!response.body) throw new Error('Image response is empty');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_PROXY_BYTES) throw new Error('Image response is too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
