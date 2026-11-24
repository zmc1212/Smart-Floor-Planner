import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import * as schema from '@/db/schema';
import {
  AssignmentRacingRepository,
  chooseDeterministicAssignmentGroup,
  hashClaimIdempotencyKey,
} from '@/db/repositories/assignment-racing-repository';

test('70/30 deterministic compensation converges without random streak drift', () => {
  let highCount = 0;
  let standardCount = 0;
  const sequence: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const group = chooseDeterministicAssignmentGroup({ highCount, standardCount, highTargetPercent: 70 });
    sequence.push(group);
    if (group === 'high') highCount += 1;
    else standardCount += 1;
  }
  assert.equal(highCount, 70);
  assert.equal(standardCount, 30);
  assert.ok(sequence.slice(0, 10).includes('standard'));
});

test('0% and 100% boundaries stay entirely in their configured group', () => {
  assert.equal(chooseDeterministicAssignmentGroup({ highCount: 0, standardCount: 0, highTargetPercent: 0 }), 'standard');
  assert.equal(chooseDeterministicAssignmentGroup({ highCount: 0, standardCount: 0, highTargetPercent: 100 }), 'high');
});

test('claim idempotency keys are stable hashes without retaining plaintext', () => {
  const first = hashClaimIdempotencyKey(' client-retry-123 ');
  const second = hashClaimIdempotencyKey('client-retry-123');
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.doesNotMatch(first, /client-retry/);
});

test('the due scan locks the lead by an unqualified PostgreSQL alias', async () => {
  const queries: string[] = [];
  const client = {
    async query(query: { text: string }) {
      queries.push(query.text);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  const repository = new AssignmentRacingRepository(drizzle(client, { schema }));

  assert.deepEqual(await repository.listDueWindows(), []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /inner join "app"\."leads" "due_lead"/i);
  assert.match(queries[0], /for update of "due_lead" skip locked$/i);
});
