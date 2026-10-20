import path from 'node:path';

// Keep earlier failed/passed evidence intact when rerunning the same scenarios.
export function continuityEvidenceDirectory() {
  const argument = process.argv.find(value => value.startsWith('--evidence='));
  const name = argument?.slice('--evidence='.length) || 'xiaok-corrections-continuity';
  if (!/^xiaok-[a-z0-9-]{1,80}$/.test(name)) throw new Error('Invalid XiaoK evidence directory name');
  return path.resolve(import.meta.dirname, '../../tmp', name);
}
