import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from '../../../admin/node_modules/sharp/lib/index.js';

const root = 'G:/workspace/向总/Smart-Floor-Planner';
const outDir = `${root}/design-references/presentation-ai-demo-2026-08`;
await fs.mkdir(outDir, { recursive: true });

const generated = [
  ['01-before-empty.jpg', 'C:/Users/Administrator/.codex/generated_images/019ff683-9158-71e1-8c4e-841ad535cd67/exec-262a58cc-46dc-43e9-84c0-d00294ba7c62.png'],
  ['02-modern-cream.jpg', 'C:/Users/Administrator/.codex/generated_images/019ff683-9158-71e1-8c4e-841ad535cd67/exec-2e979d5a-4eb8-430b-8d61-fd75d794ed9a.png'],
  ['03-modern-french.jpg', 'C:/Users/Administrator/.codex/generated_images/019ff683-9158-71e1-8c4e-841ad535cd67/exec-af8d1c6e-35ac-465c-b046-4e274b64504d.png'],
  ['04-modern-chinese.jpg', 'C:/Users/Administrator/.codex/generated_images/019ff683-9158-71e1-8c4e-841ad535cd67/exec-3b28fb08-cfc5-48ab-8785-eb9c875d051e.png'],
  ['05-material-replacement.jpg', 'C:/Users/Administrator/.codex/generated_images/019ff683-9158-71e1-8c4e-841ad535cd67/exec-e7b538ef-31b7-4173-9c04-47b5e71333e4.png'],
];

for (const [name, source] of generated) {
  await sharp(source)
    .resize(1600, 900, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(path.join(outDir, name));
}

for (const name of ['01-before-empty.jpg', '02-modern-cream.jpg', '03-modern-french.jpg', '04-modern-chinese.jpg', '05-material-replacement.jpg']) {
  await sharp(path.join(outDir, name))
    .resize(853, 1844, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(path.join(outDir, `portrait-${name}`));
}

const library = JSON.parse(await fs.readFile('C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/prompt-library.json', 'utf8'));
const selectedIds = ['906', '893', '420', '930', '401', '618', '642'];
const selected = library.templates.filter((item) => selectedIds.includes(item.id));
for (const item of selected) {
  const response = await fetch(String(item.source_url).trim());
  if (!response.ok) throw new Error(`Failed ${item.id}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = path.join(outDir, `db-${item.id}.jpg`);
  await sharp(bytes)
    .resize({ width: 1400, height: 1000, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#f8f7f2' })
    .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(target);

  await sharp(bytes)
    .resize(853, 1844, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#f8f7f2' })
    .jpeg({ quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(path.join(outDir, `portrait-db-${item.id}.jpg`));
}

const promptRecord = selected.map((item) => ({
  id: item.id,
  name: item.name,
  category: item.category_name,
  weight: item.weight,
  sourceUrl: String(item.source_url || '').trim(),
  promptContent: item.prompt_content,
}));
await fs.writeFile(
  'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/prompt-library-selection.txt',
  JSON.stringify({ revision: library.revision, templates: promptRecord }, null, 2),
  'utf8',
);

const sizes = [];

async function sideBySide(leftName, rightName, outName) {
  const left = await sharp(path.join(outDir, leftName)).resize(800, 900, { fit: 'cover' }).toBuffer();
  const right = await sharp(path.join(outDir, rightName)).resize(800, 900, { fit: 'cover' }).toBuffer();
  await sharp({ create: { width: 1604, height: 900, channels: 3, background: '#ffffff' } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 804, top: 0 },
    ])
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(path.join(outDir, outName));
}

await sideBySide('01-before-empty.jpg', '02-modern-cream.jpg', '06-compare-before-cream.jpg');
await sideBySide('02-modern-cream.jpg', '05-material-replacement.jpg', '07-compare-cream-material.jpg');

const resultComp = `${root}/design-references/all-pages-ip-v3/15-ai-design-result-v3.png`;
for (const [sourceName, targetName] of [
  ['02-modern-cream.jpg', '08-miniprogram-result-cream.png'],
  ['03-modern-french.jpg', '09-miniprogram-result-french.png'],
  ['04-modern-chinese.jpg', '10-miniprogram-result-chinese.png'],
]) {
  const stage = await sharp(path.join(outDir, sourceName))
    .resize(803, 857, { fit: 'cover', position: 'centre' })
    .toBuffer();
  await sharp(resultComp)
    .composite([{ input: stage, left: 25, top: 370 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(outDir, targetName));
}

for (const entry of await fs.readdir(outDir)) {
  const stat = await fs.stat(path.join(outDir, entry));
  sizes.push({ name: entry, bytes: stat.size });
}
console.log(JSON.stringify(sizes, null, 2));
