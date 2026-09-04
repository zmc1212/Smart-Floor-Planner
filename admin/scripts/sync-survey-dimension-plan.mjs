import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultAdminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = content => createHash('sha256').update(content).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const runtimePath = 'src/lib/survey-runtime';
const manifestPath = runtimePath + '/source-manifest.json';
const planners = ['surveyDimensionPlan.js', 'surveyWallSolidPlan.js'];
// Handwritten host typing; not a second implementation of the generated JS.
const hostFiles = [runtimePath + '/surveyCanvasRenderer.d.ts'];

async function exists(file) {
  try { await stat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function collectFiles(directory) {
  if (!await exists(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error('Unsupported mirror entry: ' + file);
  }
  return files.sort();
}

function rewriteRenderer(source) {
  const rewritten = source
    .replace("require('./surveyDimensionPlan.js')", "require('../surveyDimensionPlan.js')")
    .replace("require('./surveyWallSolidPlan.js')", "require('../surveyWallSolidPlan.js')");
  if (rewritten === source || !rewritten.includes("require('./surveyWallGraph.js')") ||
      !rewritten.includes("require('../surveyDimensionPlan.js')") ||
      !rewritten.includes("require('../surveyWallSolidPlan.js')")) {
    throw new Error('Survey renderer require rewrite failed');
  }
  return rewritten;
}

function targetFor(source) {
  if (planners.includes(source)) return 'src/lib/' + source;
  if (source === 'surveyWallGraph.js' || source === 'surveyCanvasRenderer.js' ||
      /^survey\/(?:[\w-]+\/)*[\w-]+\.js$/.test(source)) return runtimePath + '/' + source;
  throw new Error('Invalid survey source path: ' + source);
}

async function verifyInventory(adminRoot, entries) {
  const expected = entries.map(entry => entry.target).sort();
  const actual = (await collectFiles(resolve(adminRoot, runtimePath)))
    .map(file => slash(relative(adminRoot, file)))
    .filter(file => file !== manifestPath && !hostFiles.includes(file));
  for (const file of planners) {
    if (await exists(resolve(adminRoot, 'src/lib', file))) actual.push('src/lib/' + file);
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) {
    throw new Error('Survey mirror file set differs (missing: ' + expected.filter(p => !actual.includes(p)) +
      '; stale: ' + actual.filter(p => !expected.includes(p)) + ')');
  }
}

async function verifyCommittedMirror(adminRoot) {
  const manifest = JSON.parse(await readFile(resolve(adminRoot, manifestPath), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.authority !== 'miniprogram/packages/surveying/utils' ||
      !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid survey source manifest');
  const names = new Set();
  for (const entry of manifest.files) {
    if (entry.target !== targetFor(entry.source) || names.has(entry.source) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid survey mirror manifest entry');
    names.add(entry.source);
    if (digest(await readFile(resolve(adminRoot, entry.target))) !== entry.sha256) {
      throw new Error('Survey mirror hash differs: ' + entry.target);
    }
  }
  for (const required of [...planners, 'surveyWallGraph.js', 'surveyCanvasRenderer.js']) {
    if (!names.has(required)) throw new Error('Survey manifest missing ' + required);
  }
  await verifyInventory(adminRoot, manifest.files);
  return manifest.files.length;
}

export async function syncSurveyRuntime({ adminRoot = defaultAdminRoot,
  miniProgramRoot = resolve(adminRoot, '..', 'miniprogram'), check = false } = {}) {
  // Admin-only Docker builds verify the committed mirror against its generated
  // manifest. A partial source checkout is an error, never a fallback trigger.
  if (!await exists(miniProgramRoot)) {
    return { mode: 'committed-mirror', count: await verifyCommittedMirror(adminRoot) };
  }
  const sourceRoot = resolve(miniProgramRoot, 'packages/surveying/utils');
  const kernelFiles = (await collectFiles(resolve(sourceRoot, 'survey')))
    .map(file => slash(relative(sourceRoot, file)));
  if (!kernelFiles.length) throw new Error('Authoritative survey source tree is missing or empty');
  const sources = [...planners, 'surveyWallGraph.js', 'surveyCanvasRenderer.js', ...kernelFiles].sort();
  const files = [], contents = new Map();
  for (const source of sources) {
    const target = targetFor(source);
    const original = await readFile(resolve(sourceRoot, source), 'utf8');
    const content = source === 'surveyCanvasRenderer.js' ? rewriteRenderer(original) : original;
    files.push({ source, target, sha256: digest(content) });
    contents.set(target, content);
  }
  contents.set(manifestPath, JSON.stringify({ schemaVersion: 1,
    authority: 'miniprogram/packages/surveying/utils', files }, null, 2) + '\n');
  const differences = [];
  for (const [target, content] of contents) {
    const file = resolve(adminRoot, target);
    const current = await exists(file) ? await readFile(file, 'utf8') : null;
    if (current === content) continue;
    differences.push(target);
    if (!check) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }
  }
  if (check && differences.length) throw new Error('Survey source/mirror drift: ' + differences.join(', '));
  await verifyInventory(adminRoot, files);
  await verifyCommittedMirror(adminRoot);
  return { mode: check ? 'source-check' : 'source-sync', count: files.length, changed: differences.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await syncSurveyRuntime({ check: process.argv.includes('--check') });
    console.log('[survey-runtime] ' + result.mode + ': verified ' + result.count +
      ' files' + (result.changed ? '; updated ' + result.changed : '') + '.');
  } catch (error) {
    console.error('[survey-runtime] ' + error.message);
    process.exitCode = 1;
  }
}
