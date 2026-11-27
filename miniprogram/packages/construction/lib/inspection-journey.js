const maxStops = 8;
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
const shanghaiDay = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

function inspectionJourneyKey(context) {
  const enterprise = String(context?.enterpriseId || '');
  const staff = String(context?.staffId || context?.adminId || '');
  return validId(enterprise) && validId(staff) ? 'construction-inspection-journey:v1:' + enterprise + ':' + staff : '';
}

function readInspectionJourney(key) {
  if (!key) return null;
  try {
    const value = wx.getStorageSync(key);
    if (!value) return null;
    const valid = value.day === shanghaiDay() && Array.isArray(value.selected) && value.selected.length <= maxStops
      && value.selected.every(validId) && (!value.route || (typeof value.route.id === 'string'
        && Array.isArray(value.route.stops) && value.route.stops.length <= maxStops
        && value.route.stops.every(stop => validId(stop?.projectId) && Array.isArray(stop.points))
        && Array.isArray(value.route.deferred)));
    if (valid) return value;
    wx.removeStorageSync(key);
  } catch (_) { /* Storage availability never grants access to a route. */ }
  return null;
}

function saveInspectionJourney(key, value) {
  if (!key) return false;
  try { wx.setStorageSync(key, value); return true; }
  catch (_) { return false; }
}

// Cap local geometry so eight long driving legs fit in WeChat's per-key storage quota.
function routePoints(points) {
  const step = Math.max(1, Math.ceil(points.length / 500));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function makeInspectionJourney(result, job, originSite) {
  return {
    id: job.requestId,
    origin: job.input.origin,
    originSite,
    stops: result.stops.map(stop => ({ projectId: stop.projectId, pinRevision: stop.pin.revision,
      minutes: Math.ceil(stop.seconds / 60), points: routePoints(stop.points) })),
    openedId: '', deferred: [], active: true, stale: false,
  };
}

function reconcileInspectionJourney(route, stops) {
  const sites = new Map(stops.map(stop => [stop.projectId, stop]));
  const kept = route.stops.filter(stop => sites.has(stop.projectId));
  if (!kept.length) return null;
  const included = new Set(kept.map(stop => stop.projectId));
  const active = kept.some(stop => sites.get(stop.projectId).recordIds.length > 0);
  const originChanged = route.originSite && sites.get(route.originSite.projectId)?.pin?.revision !== route.originSite.pinRevision;
  const stale = route.stale || kept.length !== route.stops.length || originChanged
    || kept.some(stop => sites.get(stop.projectId).pin?.revision !== stop.pinRevision);
  if (kept.length === route.stops.length && Boolean(stale) === route.stale && active === route.active) return route;
  return { ...route, active, stale: Boolean(stale), origin: stale ? null : route.origin,
    originSite: stale ? null : route.originSite,
    stops: stale ? kept.map(stop => ({ ...stop, points: [] })) : kept,
    openedId: included.has(route.openedId) ? route.openedId : '',
    deferred: route.deferred.filter(id => included.has(id)) };
}

module.exports = { maxStops, shanghaiDay, inspectionJourneyKey, readInspectionJourney, saveInspectionJourney,
  makeInspectionJourney, reconcileInspectionJourney };
