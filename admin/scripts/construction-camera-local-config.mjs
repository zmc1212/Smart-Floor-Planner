// Local camera journeys may use a separate evaluation database and listeners.
// Service credentials remain in the explicitly selected private WVP env file.
export function cameraLocalConfig(databaseUrl, vendor, environment = {}) {
  const db = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '55432') throw Error('Isolated local database required');
  const database = environment.CAMERA_LOCAL_DATABASE || 'cloud_camera_eval';
  if (!/^cloud_camera_eval(?:_[a-z0-9_]{1,48})?$/.test(database)) throw Error('Isolated camera database name required');
  db.pathname = '/' + database;
  const listener = (value) => {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !url.port || Number(url.port) < 1024 || Number(url.port) === 3006) throw Error('Isolated loopback camera listener required');
    return url;
  };
  const app = listener(environment.CAMERA_APP_ORIGIN || 'http://127.0.0.1:3018');
  const gateway = listener(environment.CAMERA_PUBLIC_ORIGIN || 'http://localhost:3017');
  if (app.port === gateway.port) throw Error('Camera listeners must use different ports');
  const dist = environment.NEXT_DIST_DIR || '.next-camera';
  if (!/^\.next-camera(?:-[a-z0-9-]+)?$/.test(dist)) throw Error('Isolated camera build directory required');
  return {
    env: {
      DATABASE_URL: db.toString(), NEXT_DIST_DIR: dist,
      CAMERA_APP_ORIGIN: app.origin, CAMERA_PUBLIC_ORIGIN: gateway.origin,
      CAMERA_GATEWAY_PORT: gateway.port, CAMERA_BIND_HOST: '127.0.0.1',
      CAMERA_WVP_ORIGIN: environment.CAMERA_WVP_ORIGIN || 'http://127.0.0.1:18080',
      CAMERA_MEDIA_ORIGIN: environment.CAMERA_MEDIA_ORIGIN || `http://127.0.0.1:${vendor.MEDIA_HTTP_PORT || '8080'}`,
      CAMERA_WVP_USERNAME: 'admin', CAMERA_WVP_PASSWORD: vendor.WVP_ADMIN_PASSWORD,
    },
    appPort: app.port,
  };
}
