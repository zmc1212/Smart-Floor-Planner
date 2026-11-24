import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMeasureBookingBody } from '../booking/appointment';
import { businessToolDefinitions } from '../agent/business-tools';
import { conversationDto } from '../core/conversation';

test('the measure offer tool is zero-argument and never books on the model side', () => {
  const tool = businessToolDefinitions.find(item => item.name === 'offer_measure_booking');
  assert.ok(tool);
  assert.deepEqual(tool.parameters.properties, {});
  assert.equal(tool.parameters.additionalProperties, false);
  assert.match(String(tool.description), /不创建预约/);
});

test('a conversation exposes the offered flag without leaking its private payload', () => {
  const conversation = { id: '1', purpose: 'customer_consultation', status: 'open', mode: 'ai', title: '', version: 2,
    context_revision: 1, last_seq: '3', created_at: new Date(),
    entry_snapshot: { measureOffer: { at: '2026-11-19T00:00:00.000Z', runId: '9' } } };
  const dto = conversationDto(conversation as never);
  assert.equal(dto.measureOffer, true);
  assert.equal(dto.measureOfferAt, '2026-11-19T00:00:00.000Z');
  assert.equal(JSON.stringify(dto).includes('runId'), false);
  assert.equal(conversationDto({ ...conversation, entry_snapshot: {} } as never).measureOffer, false);
});

test('a measure booking body keeps explicit dates, address and map point', () => {
  const parsed = parseMeasureBookingBody({
    leadId: '10',
    startAt: '2026-11-20T06:00:00.000Z',
    endAt: '2026-11-20T07:00:00.000Z',
    address: ' 合成小区 1 栋 101 ',
    contactPhone: '+86 139-0100-0000',
    location: { locationName: '合成小区', latitude: 30.1, longitude: 120.2, coordinateSystem: 'gcj02' },
  });
  assert.equal(parsed.leadId, '10');
  assert.equal(parsed.startAt.toISOString(), '2026-11-20T06:00:00.000Z');
  assert.equal(parsed.endAt.toISOString(), '2026-11-20T07:00:00.000Z');
  assert.equal(parsed.address, '合成小区 1 栋 101');
  assert.equal(parsed.contactPhone, '13901000000');
  assert.deepEqual(parsed.location, {
    locationName: '合成小区', latitude: '30.1000000', longitude: '120.2000000', coordinateSystem: 'gcj02',
  });
});

test('a booking without a lead stays optional, while unknown fields and missing times fail', () => {
  const parsed = parseMeasureBookingBody({
    startAt: '2026-11-20T06:00:00.000Z',
    endAt: '2026-11-20T07:00:00.000Z',
    address: '合成小区 1 栋 101',
  });
  assert.equal(parsed.leadId, null);
  assert.equal(parsed.contactPhone, undefined);
  assert.throws(() => parseMeasureBookingBody({
    startAt: '2026-11-20T06:00:00.000Z', endAt: '2026-11-20T07:00:00.000Z', address: 'x', contactPhone: 'zzz13901000000',
  }), (error: { code?: string }) => error.code === 'appointment_phone_invalid');
  assert.throws(() => parseMeasureBookingBody({
    startAt: '2026-11-20T06:00:00.000Z', endAt: '2026-11-20T07:00:00.000Z', address: 'x', customerId: '1',
  }), (error: { code?: string }) => error.code === 'invalid_message');
  assert.throws(() => parseMeasureBookingBody({ startAt: '2026-11-20T06:00:00.000Z', address: 'x' }),
    (error: { code?: string; status?: number }) => error.code === 'invalid_message' || error.status === 400);
  assert.throws(() => parseMeasureBookingBody({
    startAt: '2026-11-20T06:00:00.000Z', endAt: '2026-11-20T07:00:00.000Z', address: '   ',
  }), (error: { status?: number }) => error.status === 400);
});
