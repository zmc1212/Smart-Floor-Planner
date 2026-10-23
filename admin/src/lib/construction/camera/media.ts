import { fail } from '@/lib/assistant/contracts';
import { mediaPart, type CameraStream } from './wvp';

export function cameraMediaPath(stream: CameraStream, resource: string) {
  const app = mediaPart(stream.app), name = mediaPart(stream.stream);
  if (resource === 'live.flv') return `/${app}/${name}.live.flv`;
  if (!/^[A-Za-z0-9_/-]+\.(?:m3u8|ts|mp4|m4s)$/.test(resource) || resource.includes('//') || resource.startsWith('/')) fail('camera_media_unavailable', 404);
  return `/${app}/${name}/${resource}`;
}
export function rewriteCameraPlaylist(text: string, source: URL, stream: CameraStream, generation: number) {
  if (!text.startsWith('#EXTM3U') || text.length > 262144) fail('camera_invalid_playlist', 502);
  const prefix = `/${mediaPart(stream.app)}/${mediaPart(stream.stream)}/`;
  const rewrite = (value: string) => {
    const url = new URL(value, source);
    if (url.origin !== source.origin || !url.pathname.startsWith(prefix) || url.search || url.hash) fail('camera_invalid_playlist', 502);
    const resource = url.pathname.slice(prefix.length); cameraMediaPath(stream, resource);
    return `/camera-media/${generation}/${resource}`;
  };
  return text.split(/\r?\n/).map(line => !line || line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${rewrite(value)}"`) : rewrite(line.trim())).join('\n');
}
