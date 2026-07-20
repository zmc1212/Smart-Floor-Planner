import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(scriptDirectory, '..');
const sharedFiles = [
  ['survey-dimensions', 'surveyDimensionPlan.js'],
  ['survey-wall-solid', 'surveyWallSolidPlan.js']
];

for (const [label, fileName] of sharedFiles) {
  const sourcePath = resolve(adminRoot, '..', 'miniprogram', 'utils', fileName);
  const targetPath = resolve(adminRoot, 'src', 'lib', fileName);
  let source;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch (error) {
    try {
      await readFile(targetPath, 'utf8');
      console.warn(`[${label}] Shared source unavailable; using the committed admin mirror.`);
      continue;
    } catch {
      throw error;
    }
  }

  let target = '';
  try {
    target = await readFile(targetPath, 'utf8');
  } catch {
    // The first sync creates the committed admin mirror.
  }

  if (target !== source) {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, source, 'utf8');
    console.log(`[${label}] Synced the admin mirror from the Mini Program source.`);
  }
}
