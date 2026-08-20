import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(scriptDirectory, '..');
const miniProgramRoot = resolve(adminRoot, '..', 'miniprogram');
const digest = (content) => createHash('sha256').update(content).digest('hex');

const plannerFiles = [
  ['survey-dimensions', 'surveyDimensionPlan.js'],
  ['survey-wall-solid', 'surveyWallSolidPlan.js'],
];

function rewriteCanvasRenderer(source) {
  return source
    .replace(
      "require('../../../utils/surveyWallGraph.js')",
      "require('./surveyWallGraph.js')",
    )
    .replace(
      "require('./surveyDimensionPlan.js')",
      "require('../surveyDimensionPlan.js')",
    )
    .replace(
      "require('./surveyWallSolidPlan.js')",
      "require('../surveyWallSolidPlan.js')",
    );
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function writeIfChanged(targetPath, content, label) {
  const current = await readOptional(targetPath);
  if (current === content) {
    console.log(`[${label}] Mirror verified (${digest(content)}).`);
    return;
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, 'utf8');
  console.log(`[${label}] Synced the admin mirror from the Mini Program source.`);
  const written = await readFile(targetPath, 'utf8');
  if (digest(written) !== digest(content)) {
    throw new Error(`[${label}] Shared source and admin mirror hashes differ.`);
  }
  console.log(`[${label}] Mirror verified (${digest(written)}).`);
}

async function syncExactFile(label, sourcePath, targetPath) {
  let source;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch (error) {
    const target = await readOptional(targetPath);
    if (target) {
      console.warn(`[${label}] Shared source unavailable; using the committed admin mirror.`);
      return;
    }
    throw error;
  }
  await writeIfChanged(targetPath, source, label);
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function syncSurveyKernel() {
  const sourceRoot = resolve(miniProgramRoot, 'utils', 'survey');
  const targetRoot = resolve(adminRoot, 'src', 'lib', 'survey-runtime', 'survey');
  try {
    await readFile(resolve(sourceRoot, 'legacy-kernel.js'), 'utf8');
  } catch (error) {
    try {
      await readFile(resolve(targetRoot, 'legacy-kernel.js'), 'utf8');
      console.warn('[survey-kernel] Shared source unavailable; using the committed admin mirror.');
      return;
    } catch {
      throw error;
    }
  }

  const sourceFiles = await collectFiles(sourceRoot);
  for (const sourcePath of sourceFiles) {
    const relativePath = relative(sourceRoot, sourcePath).replaceAll('\\', '/');
    const targetPath = resolve(targetRoot, relativePath);
    const source = await readFile(sourcePath, 'utf8');
    await writeIfChanged(targetPath, source, `survey-kernel:${relativePath}`);
  }
}

for (const [label, fileName] of plannerFiles) {
  await syncExactFile(
    label,
    resolve(miniProgramRoot, 'packages', 'surveying', 'utils', fileName),
    resolve(adminRoot, 'src', 'lib', fileName),
  );
}

await syncExactFile(
  'survey-wall-graph',
  resolve(miniProgramRoot, 'utils', 'surveyWallGraph.js'),
  resolve(adminRoot, 'src', 'lib', 'survey-runtime', 'surveyWallGraph.js'),
);

await syncSurveyKernel();

const rendererSourcePath = resolve(
  miniProgramRoot,
  'packages',
  'surveying',
  'utils',
  'surveyCanvasRenderer.js',
);
const rendererTargetPath = resolve(
  adminRoot,
  'src',
  'lib',
  'survey-runtime',
  'surveyCanvasRenderer.js',
);
let rendererSource;
try {
  rendererSource = await readFile(rendererSourcePath, 'utf8');
} catch (error) {
  const target = await readOptional(rendererTargetPath);
  if (target) {
    console.warn('[survey-canvas-renderer] Shared source unavailable; using the committed admin mirror.');
  } else {
    throw error;
  }
}
if (rendererSource) {
  const rewritten = rewriteCanvasRenderer(rendererSource);
  if (
    rewritten === rendererSource
    || !rewritten.includes("require('./surveyWallGraph.js')")
    || !rewritten.includes("require('../surveyDimensionPlan.js')")
    || !rewritten.includes("require('../surveyWallSolidPlan.js')")
  ) {
    throw new Error('[survey-canvas-renderer] Require rewrite did not produce the admin runtime paths.');
  }
  await writeIfChanged(rendererTargetPath, rewritten, 'survey-canvas-renderer');
}
