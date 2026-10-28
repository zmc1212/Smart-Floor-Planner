import { createHash } from 'node:crypto';
import { fail } from '../contracts';

export const maxSpeechBytes = 2 * 1024 * 1024;
/** Only the recorder's bounded PCM WAV contract, never a file extension or client duration. */
export function speechAudio(bytes: Buffer) {
  if (bytes.length < 44 || bytes.length > maxSpeechBytes || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('speech_audio_invalid', 422);
  let fmt = false, data = 0, seenData = false, offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4), n = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + n > bytes.length) fail('speech_audio_invalid', 422);
    if (kind === 'fmt ') {
      if (fmt || n < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1
        || bytes.readUInt32LE(start + 4) !== 16000 || bytes.readUInt32LE(start + 8) !== 32000
        || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) fail('speech_audio_invalid', 422);
      fmt = true;
    } else if (kind === 'data') {
      if (seenData || n % 2) fail('speech_audio_invalid', 422);
      seenData = true; data = n;
    }
    offset = start + n + (n % 2);
  }
  const durationMs = data / 32;
  if (offset !== bytes.length || !fmt || !seenData || durationMs < 300 || durationMs > 60000) fail('speech_audio_invalid', 422);
  return { hash: createHash('sha256').update(bytes).digest('hex'), durationMs: Math.ceil(durationMs), mime: 'audio/wav' };
}
