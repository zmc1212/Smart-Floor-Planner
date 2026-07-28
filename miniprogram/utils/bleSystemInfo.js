const ATS_FRAME_LENGTH = 28;
const ATS_HEADER = [0x41, 0x54, 0x53];

const MACHINE_MODE_LABELS = {
  0: 'Length',
  1: 'Area',
  2: 'Volume',
  4: 'Triangle angle/height',
  5: 'Triangle height',
  6: 'Triangle hypotenuse',
  7: 'Triangle centerline',
  8: 'Triangle short side',
  9: 'Triangle area',
  10: 'Level',
  11: 'Trapezoid',
  15: 'Delay',
  16: 'Stakeout',
  17: 'Settings',
  19: 'Continuous measurement',
};

const REFERENCE_POSITION_LABELS = {
  0: 'Front',
  1: 'Center locating hole',
  2: 'Rear',
  3: 'Extension tail',
};

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function checksum(bytes, endExclusive) {
  var sum = 0;
  for (var index = 0; index < endExclusive; index += 1) {
    sum += bytes[index];
  }
  return sum % 256;
}

function toHex(value, width) {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function getMachineModeLabel(mode) {
  return MACHINE_MODE_LABELS[mode] || ('Mode ' + mode);
}

function getReferencePositionLabel(position) {
  return REFERENCE_POSITION_LABELS[position] || ('Reference position ' + position);
}

function parseSystemInfoFrame(input) {
  var bytes = Array.prototype.slice.call(input || []);

  if (bytes.length !== ATS_FRAME_LENGTH) {
    return { valid: false, reason: 'Unexpected ATS frame length' };
  }

  for (var index = 0; index < ATS_HEADER.length; index += 1) {
    if (bytes[index] !== ATS_HEADER[index]) {
      return { valid: false, reason: 'Unexpected ATS frame header' };
    }
  }

  if (bytes[ATS_FRAME_LENGTH - 1] !== 0x23) {
    return { valid: false, reason: 'Missing ATS frame terminator' };
  }

  var expectedCrc = checksum(bytes, ATS_FRAME_LENGTH - 2);
  var actualCrc = bytes[ATS_FRAME_LENGTH - 2];
  if (expectedCrc !== actualCrc) {
    return { valid: false, reason: 'ATS CRC mismatch' };
  }

  var machineMode = bytes[8];
  var referencePosition = bytes[14] & 0x0F;
  var stakeoutARaw = readUint32LE(bytes, 15);
  var stakeoutBRaw = readUint32LE(bytes, 19);

  return {
    valid: true,
    value: {
      productId: readUint16LE(bytes, 3),
      productIdHex: '0x' + toHex(readUint16LE(bytes, 3), 4),
      storedRecordCount: readUint16LE(bytes, 5),
      unitCode: bytes[7],
      machineMode: machineMode,
      machineModeLabel: getMachineModeLabel(machineMode),
      backlightSeconds: readUint16LE(bytes, 9),
      autoPowerOffSeconds: readUint16LE(bytes, 11),
      soundEnabled: bytes[13] !== 0,
      referencePosition: referencePosition,
      referencePositionLabel: getReferencePositionLabel(referencePosition),
      stakeoutARaw: stakeoutARaw,
      stakeoutAMeters: stakeoutARaw / 10000,
      stakeoutBRaw: stakeoutBRaw,
      stakeoutBMeters: stakeoutBRaw / 10000,
      angleUnitCode: bytes[23],
      laserOffSeconds: bytes[24],
      selfCalibrationValue: bytes[25],
      rawHex: bytes.map(function (byte) { return toHex(byte, 2); }).join(' '),
    },
  };
}

module.exports = {
  ATS_FRAME_LENGTH: ATS_FRAME_LENGTH,
  parseSystemInfoFrame: parseSystemInfoFrame,
  getMachineModeLabel: getMachineModeLabel,
  getReferencePositionLabel: getReferencePositionLabel,
};
