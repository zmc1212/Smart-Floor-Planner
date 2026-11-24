const earthRadius = 6378245;
const eccentricity = 0.006693421622965943;

function latitudeShift(x, y) {
  return -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
    + (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y * Math.PI / 3)) * 2 / 3
    + (160 * Math.sin(y * Math.PI / 12) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
}

function longitudeShift(x, y) {
  return 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
    + (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x * Math.PI / 3)) * 2 / 3
    + (150 * Math.sin(x * Math.PI / 12) + 300 * Math.sin(x * Math.PI / 30)) * 2 / 3;
}

function toNativeMapPoint({ latitude, longitude }) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) {
    return { latitude, longitude };
  }
  const radians = latitude * Math.PI / 180;
  const sinLatitude = Math.sin(radians);
  const ellipsoid = 1 - eccentricity * sinLatitude * sinLatitude;
  const root = Math.sqrt(ellipsoid);
  const x = longitude - 105, y = latitude - 35;
  return {
    latitude: latitude + latitudeShift(x, y) * 180 * ellipsoid * root / (earthRadius * (1 - eccentricity) * Math.PI),
    longitude: longitude + longitudeShift(x, y) * 180 * root / (earthRadius * Math.cos(radians) * Math.PI),
  };
}

// Map taps arrive in GCJ-02. The route service and stored entrance pins use WGS84.
function fromNativeMapPoint({ latitude, longitude }) {
  const estimate = { latitude, longitude };
  for (let i = 0; i < 3; i++) {
    const projected = toNativeMapPoint(estimate);
    estimate.latitude += latitude - projected.latitude;
    estimate.longitude += longitude - projected.longitude;
  }
  return estimate;
}

module.exports = { toNativeMapPoint, fromNativeMapPoint };
