import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fail, fingerprint } from '../contracts';
import { speechAudio } from './audio';

export function speechConfig() {
  if (process.env.ASSISTANT_ASR_PROVIDER !== 'local-faster-whisper') return null;
  const python = process.env.ASSISTANT_ASR_PYTHON || '', model = process.env.ASSISTANT_ASR_MODEL_PATH || '', sha256 = process.env.ASSISTANT_ASR_MODEL_SHA256 || '';
  if (!path.isAbsolute(python) || !path.isAbsolute(model) || !/^[a-f0-9]{64}$/.test(sha256)
    || !existsSync(python) || !['model.bin', 'config.json', 'tokenizer.json'].every(f => existsSync(path.join(model, f)))) return null;
  const adapter = path.resolve(process.cwd(), 'scripts/assistant-speech-local.py'); if (!existsSync(adapter)) return null;
  const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  try {
    const metadataHash = fingerprint({ config: digest(path.join(model, 'config.json')), tokenizer: digest(path.join(model, 'tokenizer.json')) });
    return { provider: 'local-faster-whisper' as const, python, model, sha256, metadataHash, adapterHash: digest(adapter), protocol: 'local-speech-v1' };
  } catch { return null; }
}
export function speechConfigurationHash() { const config = speechConfig(); return config ? fingerprint(config) : null; }
/** Explicit local executable/model only; no URL, download, paid provider or automatic fallback. */
export async function transcribeLocal(bytes: Buffer) {
  const config = speechConfig(); if (!config) fail('speech_unavailable', 503);
  const audio = speechAudio(bytes), binding = fingerprint(config);
  return new Promise<{ text: string; durationMs: number; modelHash: string; configurationHash: string }>((resolve, reject) => {
    const child = spawn(config.python, ['-X', 'utf8', path.resolve(process.cwd(), 'scripts/assistant-speech-local.py'), '--model', config.model, '--sha256', config.sha256],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } });
    const chunks: Buffer[] = []; let length = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
    child.stdout.on('data', data => { length += data.length; if (length > 24000) child.kill(); else chunks.push(Buffer.from(data)); });
    child.stderr.resume(); // Do not put raw private transcripts or Python traces into the application log.
    child.stdin.on('error', () => undefined);
    child.on('error', () => { clearTimeout(timer); reject(new Error('speech_local_failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code || timedOut || length > 24000) { reject(new Error(timedOut ? 'speech_timeout' : 'speech_local_failed')); return; }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 4000 || result.modelHash !== config.sha256 || result.metadataHash !== config.metadataHash
          || result.durationMs !== audio.durationMs || speechConfigurationHash() !== binding) throw Error();
        resolve({ text: result.text.trim(), durationMs: audio.durationMs, modelHash: result.modelHash, configurationHash: binding });
      } catch { reject(new Error('speech_transcription_invalid')); }
    });
    child.stdin.end(bytes);
  });
}
