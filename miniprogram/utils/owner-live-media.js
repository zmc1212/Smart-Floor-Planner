const manifest = /^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/api\/public\/construction-live\/([1-9]\d{0,18})\/([a-f0-9]{48})\/media\/([A-Za-z0-9_-]{43})\/hls\.m3u8$/;

function ownerLiveMedia(url, baseUrls) {
  const match = typeof url === 'string' && manifest.exec(url);
  if (!match) return null;
  const origin = match[1] || baseUrls()[0]?.replace(/\/api$/, '');
  if (!origin) return null;
  const src = match[1] ? url : origin + url;
  return { src, played: src.replace(/\/hls\.m3u8$/, '/played'), webview: origin + '/construction-camera#ownerLive=' + match.slice(2).join('.') };
}

module.exports = { ownerLiveMedia };
