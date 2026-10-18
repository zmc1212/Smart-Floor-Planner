// Explicit allow-list for the two documented isolated evaluation environments.
// Never follow the user's current/default Docker context implicitly.
export function resolveRestoreTarget(env = process.env) {
  const targets = {
    local: { context: 'desktop-linux', endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine', container: 'xiaok-vector-eval', port: '55432' },
    'remote-dev': { context: 'sfp-remote-dev', endpoint: 'ssh://sfp-remote-dev', container: 'sfp-remote-dev-vector', port: '15433' },
  };
  const key = env.XIAOK_RESTORE_TARGET || 'local';
  if (!Object.hasOwn(targets, key)) throw new Error('Restore target must be local or remote-dev');
  const target = { ...targets[key], database: 'xiaok_embedding_eval', owner: 'vector_probe_owner' };
  for (const [name, expected] of [['CONTAINER', target.container], ['DATABASE', target.database], ['OWNER', target.owner]]) {
    if (env[`XIAOK_RESTORE_SOURCE_${name}`] && env[`XIAOK_RESTORE_SOURCE_${name}`] !== expected) {
      throw new Error(`XIAOK_RESTORE_SOURCE_${name} conflicts with the isolated restore target`);
    }
  }
  return target;
}

export function validateRestorePorts(ports, target) {
  const published = Object.entries(ports).filter(([, bindings]) => bindings !== null);
  if (published.length !== 1 || published[0][0] !== '5432/tcp'
    || !Array.isArray(published[0][1]) || published[0][1].length !== 1
    || published[0][1][0].HostIp !== '127.0.0.1' || published[0][1][0].HostPort !== target.port) {
    throw new Error('Restore source must expose exactly the approved loopback evaluation port');
  }
}
