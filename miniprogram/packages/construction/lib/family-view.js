function displayName(value, fallback) {
  const name = String(value || '').trim();
  // Older project and viewer names can contain a contact number.
  const redacted = name.replace(/(^|[^\d])(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d{4}[ -]?\d{4}|[*＊]{4}\d{4})(?!\d)/g, '$1');
  return (redacted === name ? name : redacted
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/^[\s·•｜|/，,；;：:-]+|[\s·•｜|/，,；;：:-]+$/g, '')) || fallback;
}

function familyErrorText(error, fallback = '云工地暂时打不开，请重试。') {
  const code = error && (error.error || error.code);
  if (error?.statusCode === 401) return '请先登录后再打开。';
  if (code === 'family_invite_used') return '这份邀请已经被使用，请让家人重新分享。';
  if (code === 'construction_invite_invalid' || code === 'construction_invite_expired')
    return '邀请已失效，请让家人重新分享。';
  if (code === 'construction_not_found' || code === 'construction_forbidden'
    || code === 'camera_forbidden' || code === 'camera_project_unavailable')
    return '暂时无法查看这个工地。';
  if (code === 'version_conflict') return '名单已更新，请重试。';
  return fallback;
}

module.exports = { displayName, familyErrorText };
