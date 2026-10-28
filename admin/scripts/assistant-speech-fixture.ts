/** Synthetic PCM for deterministic protocol/service checks; never ASR quality evidence. */
export function speechWav(milliseconds = 1000) {
  const size = milliseconds * 32, b = Buffer.alloc(44 + size); b.write('RIFF'); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40); return b;
}
