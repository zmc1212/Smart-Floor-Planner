import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fail } from '../contracts';

const windowsSpeech = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$wave = [IO.MemoryStream]::new()
try {
  $speaker.SelectVoice('Microsoft Huihui Desktop')
  $speaker.SetOutputToWaveStream($wave)
  $speaker.Speak([Console]::In.ReadToEnd())
  $wave.Position = 0
  $wave.CopyTo([Console]::OpenStandardOutput())
} finally {
  $speaker.Dispose()
  $wave.Dispose()
}
`;

function localSpeechCommand(): [string, string[]] | undefined {
  const provider = process.env.ASSISTANT_TTS_PROVIDER;
  if (provider === 'local-windows' && process.platform === 'win32')
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsSpeech]];
  const executable = process.env.ASSISTANT_TTS_EXECUTABLE;
  if (provider === 'local-espeak-ng' && executable && isAbsolute(executable) && existsSync(executable))
    return [executable, ['--stdin', '--stdout', '-v', 'cmn']];
}

export function readAloudAvailable(text: string) {
  return !!localSpeechCommand() && !!text.trim() && Array.from(text).length <= 1200;
}

let active = 0;
const maxAudioBytes = 16 * 1024 * 1024;
export async function synthesizeReply(text: string) {
  const command = localSpeechCommand();
  if (!command || !readAloudAvailable(text)) fail('speech_unavailable', 503);
  if (active >= 2) fail('speech_unavailable', 503);
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(...command, { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      const failure = () => reject(new Error('speech_synthesis_failed'));
      const timer = setTimeout(() => child.kill(), 30000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxAudioBytes) child.kill(); else chunks.push(chunk);
      });
      child.on('error', () => { clearTimeout(timer); failure(); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        if (code || size > maxAudioBytes || size < 44) return failure();
        const wave = Buffer.concat(chunks);
        if (wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 12) !== 'WAVE') return failure();
        // eSpeak's stdout mode writes a streaming size. A complete download
        // has a known RIFF length and a finite PCM data chunk.
        const offset = wave.indexOf('data', 12);
        if (offset < 0 || offset + 8 >= wave.length) return failure();
        wave.writeUInt32LE(wave.length - 8, 4);
        wave.writeUInt32LE(wave.length - offset - 8, offset + 4);
        resolve(wave);
      });
      child.stdin.end(text, 'utf8');
    });
  } catch {
    fail('speech_unavailable', 503);
  } finally {
    active--;
  }
}
