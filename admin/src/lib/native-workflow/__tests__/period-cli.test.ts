import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addCalendarDays,
  parseBatchReceiverTargets,
  parseBossIdArg,
  parseDesignerIdArg,
  parsePeriodKind,
  parsePeriodKindArg,
  parseReceiverArg,
  parseReceiverKindArg,
  parseWorkerIdArg,
  PERIOD_DEFINITION_ID,
  readCliOption,
  resolveCliPeriod,
} from '../live/period-cli';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? '';
  }
  assert.fail('expected the period helper to throw');
}

test('period kind defaults to daily and accepts weekly', () => {
  assert.equal(parsePeriodKind(undefined), 'daily');
  assert.equal(parsePeriodKind('daily'), 'daily');
  assert.equal(parsePeriodKind('weekly'), 'weekly');
  const invalid = ['monthly', 'Daily', '', 'daily '];
  for (const kind of invalid) {
    assert.equal(codeOf(() => parsePeriodKind(kind)), 'period_kind_invalid');
  }
});

test('period kind argument separates absent from valueless and invalid', () => {
  assert.equal(parsePeriodKindArg([]), 'daily');
  assert.equal(parsePeriodKindArg(['--development', '--period-start', '2026-10-26']), 'daily');
  assert.equal(parsePeriodKindArg(['--period-kind', 'daily']), 'daily');
  assert.equal(parsePeriodKindArg(['--period-kind', 'weekly']), 'weekly');
  assert.equal(
    codeOf(() => parsePeriodKindArg(['--development', '--period-start', '2026-10-26', '--period-kind'])),
    'period_kind_missing',
  );
  assert.equal(
    codeOf(() => parsePeriodKindArg(['--period-kind', '--period-start', '2026-10-26'])),
    'period_kind_missing',
  );
  // An inline empty value is also "present without a value", never daily.
  assert.equal(codeOf(() => parsePeriodKindArg(['--period-kind='])), 'period_kind_missing');
  assert.equal(
    codeOf(() => parsePeriodKindArg(['--period-kind', 'monthly'])),
    'period_kind_invalid',
  );
  assert.equal(
    codeOf(() => parsePeriodKindArg(['--period-kind', 'Daily'])),
    'period_kind_invalid',
  );
});

test('a valueless period kind is rejected before it could default to daily', () => {
  try {
    parsePeriodKindArg(['--period-kind']);
    assert.fail('a valueless --period-kind must throw');
  } catch (error) {
    assert.equal((error as { code?: string }).code, 'period_kind_missing');
    assert.match((error as Error).message, /--period-kind requires a value/u);
  }
});

test('receiver kind defaults to customer and accepts worker', () => {
  assert.equal(parseReceiverKindArg([]), 'customer');
  assert.equal(parseReceiverKindArg(['--development', '--period-start', '2026-10-26']), 'customer');
  assert.equal(parseReceiverKindArg(['--receiver-kind', 'customer']), 'customer');
  assert.equal(parseReceiverKindArg(['--receiver-kind=worker']), 'worker');
  assert.equal(
    codeOf(() => parseReceiverKindArg(['--receiver-kind', '--worker-id', '1454000008'])),
    'receiver_kind_missing',
  );
  assert.equal(codeOf(() => parseReceiverKindArg(['--receiver-kind='])), 'receiver_kind_missing');
  assert.equal(parseReceiverKindArg(['--receiver-kind', 'boss']), 'boss');
  assert.equal(codeOf(() => parseReceiverKindArg(['--receiver-kind', 'service'])), 'receiver_kind_invalid');
});

test('worker receiver requires a positive admin id', () => {
  assert.deepEqual(parseReceiverArg(['--receiver-kind', 'worker', '--worker-id', '1454000008']), {
    kind: 'worker',
    adminId: '1454000008',
  });
  assert.deepEqual(parseReceiverArg(['--receiver-kind=worker', '--worker-id=1454000008']), {
    kind: 'worker',
    adminId: '1454000008',
  });
  assert.deepEqual(parseReceiverArg(['--receiver-kind', 'customer']), { kind: 'customer' });
  assert.deepEqual(parseReceiverArg([]), { kind: 'customer' });

  assert.equal(
    codeOf(() => parseWorkerIdArg(['--receiver-kind', 'worker'], 'worker')),
    'worker_id_missing',
  );
  assert.equal(
    codeOf(() => parseWorkerIdArg(['--receiver-kind=worker'], 'worker')),
    'worker_id_missing',
  );
  for (const argv of [
    ['--worker-id'],
    ['--worker-id='],
    ['--worker-id', '--period-start'],
    ['--worker-id', 'abc'],
    ['--worker-id', '0'],
    ['--worker-id', '-1'],
    ['--worker-id', '1.5'],
  ]) {
    assert.equal(
      codeOf(() => parseWorkerIdArg(argv, 'worker')),
      'worker_id_invalid',
      `expected worker_id_invalid for ${JSON.stringify(argv)}`,
    );
  }
});

test('a customer receiver rejects --worker-id', () => {
  assert.equal(
    codeOf(() => parseWorkerIdArg(['--worker-id', '1454000008'], 'customer')),
    'worker_id_forbidden',
  );
  assert.equal(
    codeOf(() => parseReceiverArg(['--worker-id', '1454000008'])),
    'worker_id_forbidden',
  );
});

test('receiver flags stay independent from the period kind', () => {
  assert.equal(parsePeriodKindArg(['--receiver-kind', 'customer', '--period-kind', 'weekly']), 'weekly');
  assert.equal(parsePeriodKindArg(['--receiver-kind', 'worker', '--period-kind', 'daily']), 'daily');
  assert.deepEqual(
    parseReceiverArg(['--period-kind', 'weekly', '--receiver-kind', 'worker', '--worker-id', '1454000008']),
    { kind: 'worker', adminId: '1454000008' },
  );
  assert.equal(
    resolveCliPeriod({ kind: 'weekly', periodStart: '2026-10-26' }).periodEnd,
    '2026-11-02',
  );
});

test('readCliOption distinguishes an absent option from a valueless one', () => {
  assert.deepEqual(readCliOption([], '--period-kind'), { present: false });
  assert.deepEqual(readCliOption(['--period-kind', 'weekly'], '--period-kind'), {
    present: true,
    value: 'weekly',
  });
  assert.deepEqual(readCliOption(['--period-kind'], '--period-kind'), { present: true });
  assert.deepEqual(readCliOption(['--period-kind', '--development'], '--period-kind'), { present: true });
  assert.deepEqual(readCliOption(['--period-kind='], '--period-kind'), { present: true });
  assert.deepEqual(readCliOption(['--period-kind=daily'], '--period-kind'), {
    present: true,
    value: 'daily',
  });
});

test('daily keeps the original single-day command', () => {
  const resolved = resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03' });
  assert.deepEqual(resolved, {
    kind: 'daily',
    periodStart: '2026-11-03',
    periodEnd: '2026-11-03',
    definitionId: PERIOD_DEFINITION_ID.daily,
    eventId: 'b5-period-daily-2026-11-03',
  });
  assert.equal(resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03', periodEnd: '2026-11-03' })
    .periodEnd, '2026-11-03');
});

test('daily rejects a span that is not one calendar day', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-11-03', periodEnd: '2026-11-04' })),
    'period_end_invalid',
  );
});

test('weekly derives the exclusive Monday-to-Monday window', () => {
  const resolved = resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02' });
  assert.deepEqual(resolved, {
    kind: 'weekly',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-09',
    definitionId: PERIOD_DEFINITION_ID.weekly,
    eventId: 'b5-period-weekly-2026-11-02',
  });
  assert.equal(addCalendarDays('2026-10-26', 7), '2026-11-02');
  assert.equal(addCalendarDays('2026-12-28', 7), '2027-01-04');
});

test('weekly accepts an explicit matching period end', () => {
  const resolved = resolveCliPeriod({
    kind: 'weekly',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-09',
  });
  assert.equal(resolved.periodEnd, '2026-11-09');
});

test('weekly rejects a non-Monday start', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-03' })),
    'period_start_not_monday',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-08' })),
    'period_start_not_monday',
  );
});

test('weekly rejects a partial or over-long week', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-06' })),
    'period_end_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-16' })),
    'period_end_invalid',
  );
});

test('invalid calendar dates are rejected for both kinds', () => {
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-02-30' })),
    'periodStart_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-13-01' })),
    'periodStart_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-31' })),
    'periodEnd_invalid',
  );
  assert.equal(
    codeOf(() => resolveCliPeriod({ kind: 'daily', periodStart: '2026-1-03' })),
    'periodStart_invalid',
  );
});

test('designer receiver requires --designer-id and never accepts --worker-id', () => {
  assert.deepEqual(
    parseReceiverArg(['--receiver-kind', 'designer', '--designer-id', '1454000011']),
    { kind: 'designer', adminId: '1454000011' },
  );
  assert.deepEqual(
    parseReceiverArg(['--receiver-kind=designer', '--designer-id=1454000011']),
    { kind: 'designer', adminId: '1454000011' },
  );
  assert.equal(parseReceiverKindArg(['--receiver-kind', 'designer']), 'designer');
  assert.equal(
    codeOf(() => parseDesignerIdArg(['--receiver-kind', 'designer'], 'designer')),
    'designer_id_missing',
  );
  assert.equal(
    codeOf(() => parseDesignerIdArg(['--designer-id='], 'designer')),
    'designer_id_invalid',
  );
  for (const argv of [
    ['--designer-id', 'abc'],
    ['--designer-id', '0'],
    ['--designer-id', '-1'],
  ]) {
    assert.equal(codeOf(() => parseDesignerIdArg(argv, 'designer')), 'designer_id_invalid');
  }
  // A designer receiver must carry its own id flag, not the worker flag.
  assert.equal(
    codeOf(() => parseReceiverArg(['--receiver-kind', 'designer', '--worker-id', '1454000008'])),
    'designer_id_missing',
  );
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'designer', '--designer-id', '1454000011', '--worker-id', '1454000008',
    ])),
    'worker_id_forbidden',
  );
  // A worker receiver must not smuggle a designer id either.
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'worker', '--worker-id', '1454000008', '--designer-id', '1454000011',
    ])),
    'designer_id_forbidden',
  );
  // A customer receiver rejects both staff ids.
  assert.equal(
    codeOf(() => parseReceiverArg(['--designer-id', '1454000011'])),
    'designer_id_forbidden',
  );
});

test('an unknown receiver kind is rejected before any database work', () => {
  assert.equal(
    codeOf(() => parseReceiverArg(['--receiver-kind', 'service'])),
    'receiver_kind_invalid',
  );
});

test('boss receiver requires --boss-id and never accepts staff id flags', () => {
  assert.deepEqual(
    parseReceiverArg(['--receiver-kind', 'boss', '--boss-id', '1454000013']),
    { kind: 'boss', adminId: '1454000013' },
  );
  assert.deepEqual(
    parseReceiverArg(['--receiver-kind=boss', '--boss-id=1454000013']),
    { kind: 'boss', adminId: '1454000013' },
  );
  assert.equal(
    codeOf(() => parseBossIdArg(['--receiver-kind', 'boss'], 'boss')),
    'boss_id_missing',
  );
  assert.equal(
    codeOf(() => parseBossIdArg(['--boss-id='], 'boss')),
    'boss_id_invalid',
  );
  for (const argv of [
    ['--boss-id', 'abc'],
    ['--boss-id', '0'],
    ['--boss-id', '-1'],
  ]) {
    assert.equal(codeOf(() => parseBossIdArg(argv, 'boss')), 'boss_id_invalid');
  }
  assert.equal(
    codeOf(() => parseReceiverArg(['--receiver-kind', 'boss', '--worker-id', '1454000008'])),
    'boss_id_missing',
  );
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'boss', '--boss-id', '1454000013', '--worker-id', '1454000008',
    ])),
    'worker_id_forbidden',
  );
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'boss', '--boss-id', '1454000013', '--designer-id', '1454000011',
    ])),
    'designer_id_forbidden',
  );
  // Worker/designer/customer receivers must reject --boss-id.
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'worker', '--worker-id', '1454000008', '--boss-id', '1454000013',
    ])),
    'boss_id_forbidden',
  );
  assert.equal(
    codeOf(() => parseReceiverArg([
      '--receiver-kind', 'designer', '--designer-id', '1454000011', '--boss-id', '1454000013',
    ])),
    'boss_id_forbidden',
  );
  assert.equal(
    codeOf(() => parseReceiverArg(['--boss-id', '1454000013'])),
    'boss_id_forbidden',
  );
});

test('the joint entry fixes customer, worker, designer and boss in that order', () => {
  assert.deepEqual(
    parseBatchReceiverTargets([
      '--worker-id', '1454000008',
      '--designer-id', '1454000011',
      '--boss-id', '1454000013',
    ]),
    [
      { kind: 'customer' },
      { kind: 'worker', adminId: '1454000008' },
      { kind: 'designer', adminId: '1454000011' },
      { kind: 'boss', adminId: '1454000013' },
    ],
  );
  // Inline values are accepted like the single-receiver flags.
  assert.deepEqual(
    parseBatchReceiverTargets([
      '--worker-id=1454000008',
      '--designer-id=1454000011',
      '--boss-id=1454000013',
    ]).map((receiver) => receiver.kind),
    ['customer', 'worker', 'designer', 'boss'],
  );
});

test('the joint entry rejects a missing/invalid admin id or a receiver-kind override', () => {
  const base = ['--worker-id', '1454000008', '--designer-id', '1454000011', '--boss-id', '1454000013'];
  assert.equal(
    codeOf(() => parseBatchReceiverTargets(base.filter((value) => value !== '--worker-id' && value !== '1454000008'))),
    'worker_id_missing',
  );
  assert.equal(
    codeOf(() => parseBatchReceiverTargets([
      '--worker-id', '1454000008', '--designer-id', '', '--boss-id', '1454000013',
    ])),
    'designer_id_invalid',
  );
  assert.equal(
    codeOf(() => parseBatchReceiverTargets([
      '--worker-id', '1454000008', '--designer-id', '1454000011', '--boss-id', '',
    ])),
    'boss_id_invalid',
  );
  assert.equal(
    codeOf(() => parseBatchReceiverTargets([...base, '--receiver-kind', 'boss'])),
    'receiver_kind_forbidden',
  );
});
