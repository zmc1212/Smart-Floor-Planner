const test = require('node:test');
const assert = require('node:assert/strict');

const bluetooth = require('../utils/bluetooth.js');

function buildAtdFrame(distanceRaw, angleXRaw, angleYRaw) {
  const frame = Buffer.alloc(17);
  frame.write('ATD', 0, 'ascii');
  frame.writeUInt32BE(distanceRaw, 3);
  frame.writeInt32BE(angleXRaw, 7);
  frame.writeInt32BE(angleYRaw, 11);
  let crc = 0;
  for (let index = 0; index < 15; index += 1) crc += frame[index];
  frame[15] = crc % 256;
  frame[16] = 0x23;
  return frame;
}

test('ATD parser decodes distance and signed X/Y angles with raw diagnostics', () => {
  const frame = buildAtdFrame(123456, -123, 456);
  const parsed = bluetooth.__test.parseAtdFrame(
    frame,
    { serviceId: 'service-a', characteristicId: 'characteristic-a' },
    1700000000000
  );

  assert.equal(parsed.valid, true);
  assert.equal(parsed.distanceInMeters, 12.3456);
  assert.equal(parsed.metadata.angleXRaw, -123);
  assert.equal(parsed.metadata.angleXDeg, -12.3);
  assert.equal(parsed.metadata.angleYRaw, 456);
  assert.equal(parsed.metadata.angleYDeg, 45.6);
  assert.equal(parsed.metadata.crcValid, true);
  assert.equal(parsed.metadata.rawFrameHexCompact.length, 34);
  assert.equal(parsed.metadata.serviceId, 'service-a');
  assert.equal(parsed.metadata.characteristicId, 'characteristic-a');
  assert.equal(parsed.metadata.receivedAtMs, 1700000000000);
});

test('ATD parser rejects a CRC mismatch and keeps the raw response bytes', () => {
  const frame = buildAtdFrame(10000, -1, 1);
  frame[15] ^= 0xff;
  const parsed = bluetooth.__test.parseAtdFrame(frame);

  assert.equal(parsed.valid, false);
  assert.equal(parsed.error, 'crc_mismatch');
  assert.notEqual(parsed.computedCrc, parsed.receivedCrc);
  assert.match(parsed.rawFrameHex, /^41 54 44 /);
});

test('ATD dispatch suppresses only the same complete frame repeated across channels', () => {
  const delivered = [];
  const firstFrame = buildAtdFrame(20000, -25, 35);
  const secondFrame = buildAtdFrame(20001, -25, 35);
  bluetooth.__test.resetAtdFrameDeduplication();
  bluetooth.setCallbacks((distance, metadata) => delivered.push({ distance, metadata }));

  const first = bluetooth.__test.dispatchAtdFrame(firstFrame, {
    serviceId: 'service-a',
    characteristicId: 'characteristic-a'
  }, 1000);
  const duplicate = bluetooth.__test.dispatchAtdFrame(firstFrame, {
    serviceId: 'service-b',
    characteristicId: 'characteristic-b'
  }, 1100);
  const changed = bluetooth.__test.dispatchAtdFrame(secondFrame, {
    serviceId: 'service-b',
    characteristicId: 'characteristic-b'
  }, 1150);
  const sameChannelRepeat = bluetooth.__test.dispatchAtdFrame(secondFrame, {
    serviceId: 'service-b',
    characteristicId: 'characteristic-b'
  }, 1200);

  assert.equal(first.delivered, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.delivered, false);
  assert.equal(changed.duplicate, false);
  assert.equal(sameChannelRepeat.duplicate, false);
  assert.equal(delivered.length, 3);
  assert.deepEqual(delivered.map((item) => item.distance), [2, 2.0001, 2.0001]);
});

test('temporary callback ownership restores the previous measurement recipient', () => {
  const delivered = [];
  const frame = buildAtdFrame(30000, 0, 0);
  bluetooth.__test.resetAtdFrameDeduplication();
  bluetooth.setCallbacks(() => delivered.push('base'));
  const handle = bluetooth.setTemporaryCallbacks(() => delivered.push('editor'));

  bluetooth.__test.dispatchAtdFrame(frame, { characteristicId: 'a' }, 2000);
  assert.equal(bluetooth.restoreTemporaryCallbacks(handle), true);
  bluetooth.__test.dispatchAtdFrame(frame, { characteristicId: 'a' }, 2500);

  assert.deepEqual(delivered, ['editor', 'base']);
});
