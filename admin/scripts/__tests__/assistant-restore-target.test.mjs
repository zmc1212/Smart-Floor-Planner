import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveRestoreTarget, validateRestorePorts } from '../assistant-restore-target.mjs';

test('restore selects explicit documented contexts without inheriting Docker defaults', () => {
  assert.equal(resolveRestoreTarget({ DOCKER_CONTEXT: 'production' }).context, 'desktop-linux');
  const target = resolveRestoreTarget({ XIAOK_RESTORE_TARGET: 'remote-dev', DOCKER_HOST: 'tcp://production' });
  assert.equal(target.context, 'sfp-remote-dev');
  assert.equal(target.container, 'sfp-remote-dev-vector');
  assert.equal(target.endpoint, 'ssh://sfp-remote-dev');
  assert.equal(target.port, '15433');
  assert.equal(target.database, 'xiaok_embedding_eval');
});

test('unknown targets and source overrides cannot select a business database', () => {
  for (const env of [
    { XIAOK_RESTORE_TARGET: 'production' }, { XIAOK_RESTORE_TARGET: '__proto__' },
    { XIAOK_RESTORE_SOURCE_DATABASE: 'smart_floor_planner' },
    { XIAOK_RESTORE_TARGET: 'remote-dev', XIAOK_RESTORE_SOURCE_CONTAINER: 'sfp-remote-dev-postgres' },
    { XIAOK_RESTORE_SOURCE_OWNER: 'sfp_owner' },
  ]) assert.throws(() => resolveRestoreTarget(env));
});

test('only the exact evaluation loopback port is accepted', () => {
  const target = resolveRestoreTarget({ XIAOK_RESTORE_TARGET: 'remote-dev' });
  const binding = { HostIp: '127.0.0.1', HostPort: '15433' };
  assert.doesNotThrow(() => validateRestorePorts({ '5432/tcp': [binding] }, target));
  for (const ports of [
    {}, { '5432/tcp': null }, { '5432/tcp': [] },
    { '5432/tcp': [{ ...binding, HostIp: '0.0.0.0' }] },
    { '5432/tcp': [{ ...binding, HostPort: '15432' }] },
    { '5432/tcp': [binding, { ...binding, HostIp: '::' }] },
    { '5432/tcp': [binding], '1234/tcp': [binding] },
  ]) assert.throws(() => validateRestorePorts(ports, target), /exactly/);
});
