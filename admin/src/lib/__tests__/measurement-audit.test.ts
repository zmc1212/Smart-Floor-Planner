import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { measurementToDto } from '@/db/postgres-dto';
import {
  MeasurementAuditInputError,
  resolveMeasurementAuditInput,
} from '@/lib/measurement-audit';

test('top-level auditId is canonical while legacy metadata remains intact', () => {
  const metadata = { measurementMode: 'surveying', auditId: 'legacy-id', raw: 'frame' };
  const resolved = resolveMeasurementAuditInput({
    auditId: ' top-level-id ',
    metadata,
  });

  assert.equal(resolved.auditId, 'top-level-id');
  assert.equal(resolved.metadata, metadata);
  assert.equal(resolved.metadata.auditId, 'legacy-id');
});

test('legacy clients can supply the formal survey audit ID through metadata', () => {
  const resolved = resolveMeasurementAuditInput({
    metadata: { measurementMode: 'surveying', auditId: ' legacy-id ' },
  });
  assert.equal(resolved.auditId, 'legacy-id');
});

test('formal survey audits reject missing, non-string and oversized IDs', () => {
  const invalidBodies = [
    { metadata: { measurementMode: 'surveying' } },
    { auditId: 12, metadata: { measurementMode: 'surveying' } },
    { auditId: 'x'.repeat(201), metadata: { measurementMode: 'surveying' } },
  ];

  invalidBodies.forEach((body) => {
    assert.throws(
      () => resolveMeasurementAuditInput(body),
      (error: unknown) => error instanceof MeasurementAuditInputError && error.status === 400
    );
  });
});

test('non-surveying measurement sources retain optional audit IDs', () => {
  assert.equal(resolveMeasurementAuditInput({ metadata: { source: 'system' } }).auditId, null);
  assert.equal(resolveMeasurementAuditInput({ auditId: ' optional ' }).auditId, 'optional');
});

test('measurement DTO exposes the persisted audit ID and keeps metadata compatibility', () => {
  const dto = measurementToDto({
    id: 1n,
    floorPlanId: 2n,
    operatorId: null,
    enterpriseId: null,
    roomId: null,
    roomName: null,
    deviceId: null,
    auditId: 'audit-1',
    value: '2.4500',
    unit: 'meters',
    type: 'length',
    direction: null,
    metadata: { measurementMode: 'surveying', auditId: 'audit-1' },
    source: 'ble',
    measuredAt: new Date('2026-08-30T00:00:00.000Z'),
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    operator: null,
    enterprise: null,
    floorPlan: null,
  });
  assert.equal(dto.auditId, 'audit-1');
  assert.deepEqual(dto.metadata, { measurementMode: 'surveying', auditId: 'audit-1' });
});

test('measurement API maps idempotent creation to 201/200 and a deduplication flag', () => {
  const route = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/measurements/route.ts'),
    'utf8'
  );
  assert.match(route, /createIdempotent\(\{/);
  assert.match(route, /deduplicated: !creation\.created/);
  assert.match(route, /status: creation\.created \? 201 : 200/);
});

test('measurement API authorizes the linked lead collaborators', () => {
  const route = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/measurements/route.ts'),
    'utf8'
  );
  assert.match(route, /findByFloorPlanId\(floorPlan\.id\)/);
  assert.match(route, /canRecordMiniProgramFloorPlanMeasurement\(/);
});

test('audit migration is nullable, partial-unique and leaves historical rows untouched', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../../drizzle/0050_measurement_audit_idempotency.sql'),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "audit_id" text;/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS "measurements_floor_plan_audit_id_uidx"/);
  assert.match(migration, /\("floor_plan_id", "audit_id"\)[\s\S]*WHERE "audit_id" IS NOT NULL/);
  assert.doesNotMatch(migration, /\bNOT NULL\b[\s\S]*audit_id/i);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|MERGE)\b/i);
});
