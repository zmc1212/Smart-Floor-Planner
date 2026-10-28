import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speechAudio } from '../speech/audio';
import { speechConfig } from '../speech/local';
import { speechWav } from '../../../../scripts/assistant-speech-fixture';
test('only actual bounded 16k mono PCM WAV bytes determine duration/hash, never client hints', () => {
  assert.equal(speechAudio(speechWav()).durationMs, 1000); assert.equal(speechAudio(speechWav(60000)).durationMs, 60000);
  for (const n of [1, 299, 60001]) assert.throws(() => speechAudio(speechWav(n)));
  assert.throws(() => speechAudio(Buffer.from('audio.mp3')));
  for (const [offset, n] of [[4, 1], [20, 3], [22, 2], [24, 48000], [28, 1], [34, 8], [40, 999999]]) {
    const bytes = speechWav(); bytes.writeUInt32LE(n, offset); assert.throws(() => speechAudio(bytes));
  }
});
test('a missing provider or arbitrary remote provider never enables recorder/paid fallback', () => {
  const before = process.env.ASSISTANT_ASR_PROVIDER;
  try { delete process.env.ASSISTANT_ASR_PROVIDER; assert.equal(speechConfig(), null); process.env.ASSISTANT_ASR_PROVIDER = 'remote-auto'; assert.equal(speechConfig(), null); }
  finally { if (before === undefined) delete process.env.ASSISTANT_ASR_PROVIDER; else process.env.ASSISTANT_ASR_PROVIDER = before; }
});
