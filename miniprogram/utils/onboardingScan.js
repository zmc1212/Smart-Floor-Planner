const ONBOARDING_ROUTE = 'packages/business/onboarding/onboarding';

function restoreOnboardingToken(value) {
  const raw = String(value || '').trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    // Keep the original value when the QR scene is not URI encoded.
  }
  return /^[A-Za-z0-9_-]{32}$/.test(decoded) ? `ej_${decoded}` : decoded;
}

function onboardingUrlFromScanResult(scanResult) {
  const candidates = [
    String((scanResult && scanResult.path) || '').trim(),
    String((scanResult && scanResult.result) || '').trim()
  ].filter(Boolean);

  for (const raw of candidates) {
    let pathPart = raw;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        pathPart = `${parsed.pathname.replace(/^\//, '')}${parsed.search || ''}`;
      }
    } catch (error) {
      pathPart = raw;
    }

    const normalized = pathPart.replace(/^\/+/, '');
    const queryIndex = normalized.indexOf('?');
    const route = (queryIndex === -1 ? normalized : normalized.slice(0, queryIndex))
      .replace(/\.html$/, '');
    const query = queryIndex === -1 ? '' : normalized.slice(queryIndex + 1);
    if (route !== ONBOARDING_ROUTE || !/(^|&)(token|scene)=[^&]+/.test(query)) continue;
    return `/${ONBOARDING_ROUTE}${normalized.slice(queryIndex)}`;
  }
  return '';
}

function tokenFromOnboardingUrl(url) {
  const queryIndex = String(url || '').indexOf('?');
  if (queryIndex === -1) return '';
  const params = {};
  String(url).slice(queryIndex + 1).split('&').forEach((part) => {
    if (!part) return;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);
    params[key] = value;
  });
  return restoreOnboardingToken(params.token || params.scene);
}

function onboardingTokenFromScanResult(scanResult) {
  return tokenFromOnboardingUrl(onboardingUrlFromScanResult(scanResult));
}

module.exports = {
  ONBOARDING_ROUTE,
  restoreOnboardingToken,
  onboardingUrlFromScanResult,
  tokenFromOnboardingUrl,
  onboardingTokenFromScanResult
};
