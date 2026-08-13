import fs from 'node:fs/promises';

const file = 'C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/prompt-library.json';
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const categoryPattern = /家装|室内|空间|户型|风格|软装|材质|家具|效果|装修|局部|四视图|情绪板|客厅|卧室|厨房/;
const namePattern = /家装|室内|客厅|卧室|厨房|空间|户型|风格|软装|材质|家具|效果|装修|局部|四视图|情绪板|原木|奶油|侘寂|法式|现代|中式|阳台|卫生间/;
const categories = data.categories.filter((c) => categoryPattern.test(c.name));
const templates = data.templates.filter((t) => namePattern.test(t.name) || categoryPattern.test(t.category_name));
console.log('CATEGORIES');
for (const c of categories) console.log([c.source_id, c.parent_source_id || '-', c.level, c.name, c.weight].join('\t'));
console.log('\nTEMPLATES');
for (const t of templates.slice(0, 240)) {
  console.log([t.id, t.name, t.category_name, t.weight, `${t.width || 0}x${t.height || 0}`, t.source_url ? 'preview' : '-'].join('\t'));
}
