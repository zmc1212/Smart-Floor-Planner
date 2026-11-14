import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePilotScope, type PilotScopeRead } from '../pilot-scope-resolver';
import type { PilotProjectScope } from '../pilot-project-scope';

const now = new Date('2026-11-15T10:00:00+08:00');
const resolvedAt = now.toISOString();

function scope(overrides: Partial<PilotProjectScope> = {}): PilotProjectScope {
  return {
    enterpriseId: '1454',
    pilotId: 'first-pilot',
    projectIds: ['101', '205'],
    createdBy: '9001',
    createdAt: '2026-11-14T09:00:00+08:00',
    scopeVersion: 1,
    status: 'active',
    ...overrides,
  };
}

const resolve = (read: PilotScopeRead, enterpriseId = '1454', pilotId = 'first-pilot') =>
  resolvePilotScope({ enterpriseId, pilotId, context: { read, now } });

test('reads the latest active pilot scope', async () => {
  const calls: Array<[string, string]> = [];
  const result = await resolve(async (enterpriseId, pilotId) => {
    calls.push([enterpriseId, pilotId]);
    return scope({ scopeVersion: 3 });
  });

  assert.deepEqual(calls, [['1454', 'first-pilot']]);
  assert.deepEqual(result, {
    enterpriseId: '1454', pilotId: 'first-pilot', scopeVersion: 3,
    projectIds: ['101', '205'], status: 'active', resolvedAt,
  });
});

test('a missing pilot returns not_found without project defaults', async () => {
  const result = await resolve(async () => null);

  assert.deepEqual(result, {
    enterpriseId: '1454', pilotId: 'first-pilot', scopeVersion: null,
    projectIds: [], status: 'not_found', resolvedAt,
  });
});

test('an inactive latest version is returned as inactive without older projects', async () => {
  const result = await resolve(async () => scope({ scopeVersion: 4, status: 'inactive' }));

  assert.deepEqual(result, {
    enterpriseId: '1454', pilotId: 'first-pilot', scopeVersion: 4,
    projectIds: [], status: 'inactive', resolvedAt,
  });
});

test('a foreign enterprise scope is treated as not_found and never leaks project ids', async () => {
  const calls: Array<[string, string]> = [];
  const result = await resolve(async (enterpriseId, pilotId) => {
    calls.push([enterpriseId, pilotId]);
    return scope({ enterpriseId: '9001', projectIds: ['9001'] });
  });

  assert.deepEqual(calls, [['1454', 'first-pilot']]);
  assert.deepEqual(result, {
    enterpriseId: '1454', pilotId: 'first-pilot', scopeVersion: null,
    projectIds: [], status: 'not_found', resolvedAt,
  });
});

test('an empty active selection stays empty and never expands to the enterprise', async () => {
  const result = await resolve(async () => scope({ projectIds: [] }));

  assert.deepEqual(result, {
    enterpriseId: '1454', pilotId: 'first-pilot', scopeVersion: 1,
    projectIds: [], status: 'empty', resolvedAt,
  });
});

test('a new saved version replaces the previously resolved projects', async () => {
  let current = scope({ scopeVersion: 1, projectIds: ['101'] });
  const read: PilotScopeRead = async () => current;

  const first = await resolve(read);
  current = scope({ scopeVersion: 2, projectIds: ['205', '306'] });
  const second = await resolve(read);

  assert.deepEqual([first.scopeVersion, first.projectIds], [1, ['101']]);
  assert.deepEqual([second.scopeVersion, second.projectIds], [2, ['205', '306']]);
});
