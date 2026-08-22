const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bluetoothPath = require.resolve('../utils/bluetooth.js');

function loadBluetooth() {
  delete require.cache[bluetoothPath];
  const originalWx = global.wx;
  global.wx = global.wx || {};
  try {
    return require(bluetoothPath);
  } finally {
    global.wx = originalWx;
  }
}

function asciiBuffer(text) {
  return Uint8Array.from(Buffer.from(text, 'ascii')).buffer;
}

function completeLocalNameBuffer(name) {
  const body = Buffer.from(name, 'ascii');
  const packet = Buffer.alloc(2 + body.length);
  packet[0] = 1 + body.length;
  packet[1] = 0x09;
  body.copy(packet, 2);
  return packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
}

test('iOS discovery keeps duplicate advertisements so a later local name can arrive', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'bluetooth.js'), 'utf8');
  assert.match(source, /allowDuplicatesKey:\s*true/);
});

test('empty GAP name still matches LDMStudio from iOS localName', () => {
  const bluetooth = loadBluetooth();
  assert.equal(
    bluetooth.resolveDeviceName({ name: '', localName: 'LDMStudio 4D' }),
    'LDMStudio 4D'
  );
  assert.equal(bluetooth.isTargetRangefinderName('LDMStudio 4D'), true);
});

test('empty name and localName still match LDMStudio from Complete Local Name AD', () => {
  const bluetooth = loadBluetooth();
  const name = bluetooth.resolveDeviceName({
    name: '',
    localName: '',
    advertisData: completeLocalNameBuffer('LDMStudio 4D')
  });
  assert.equal(name, 'LDMStudio 4D');
});

test('manufacturer advertisData ASCII still identifies an unnamed LDMStudio on iOS', () => {
  const bluetooth = loadBluetooth();
  const name = bluetooth.resolveDeviceName({
    name: '',
    localName: '',
    advertisData: asciiBuffer('\u0000\u0001LDMStudio 4D')
  });
  assert.match(name, /LDMSTUDIO/i);
});
