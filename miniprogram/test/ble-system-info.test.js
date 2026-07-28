const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSystemInfoFrame } = require('../utils/bleSystemInfo.js');

function withCrc(frame) {
  const crc = frame.slice(0, -2).reduce((sum, byte) => sum + byte, 0) % 256;
  frame[frame.length - 2] = crc;
  return frame;
}

test('parses the ATS001 system information frame defined by the vendor protocol', () => {
  const frame = withCrc([
    0x41, 0x54, 0x53,
    0x43, 0x41,
    0x00, 0x00,
    0x01,
    0x02,
    0x0F, 0x00,
    0x00, 0x01,
    0x01,
    0x00,
    0x70, 0x17, 0x00, 0x00,
    0x40, 0x1F, 0x00, 0x00,
    0x00,
    0x64,
    0x00,
    0x00,
    0x23,
  ]);

  const result = parseSystemInfoFrame(frame);

  assert.equal(result.valid, true);
  assert.equal(result.value.productIdHex, '0x4143');
  assert.equal(result.value.storedRecordCount, 0);
  assert.equal(result.value.machineModeLabel, 'Volume');
  assert.equal(result.value.backlightSeconds, 15);
  assert.equal(result.value.autoPowerOffSeconds, 256);
  assert.equal(result.value.soundEnabled, true);
  assert.equal(result.value.referencePositionLabel, 'Front');
  assert.equal(result.value.stakeoutAMeters, 0.6);
  assert.equal(result.value.stakeoutBMeters, 0.8);
  assert.equal(result.value.laserOffSeconds, 100);
});

test('rejects ATS frames with a bad CRC or incomplete payload', () => {
  assert.equal(parseSystemInfoFrame([0x41, 0x54, 0x53]).valid, false);

  const invalidCrcFrame = new Array(28).fill(0);
  invalidCrcFrame[0] = 0x41;
  invalidCrcFrame[1] = 0x54;
  invalidCrcFrame[2] = 0x53;
  invalidCrcFrame[27] = 0x23;
  assert.equal(parseSystemInfoFrame(invalidCrcFrame).valid, false);
});
