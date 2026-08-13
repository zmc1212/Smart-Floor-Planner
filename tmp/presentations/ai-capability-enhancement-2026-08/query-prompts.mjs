import fs from 'node:fs/promises';
import pg from '../../../admin/node_modules/pg/lib/index.js';
const { Client } = pg;

const root = 'G:/workspace/向总/Smart-Floor-Planner';
const envText = await fs.readFile(`${root}/admin/.env.local`, 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 1) continue;
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = value;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const revisionResult = await client.query(`
    select id::text, revision_key, published_at
    from app.ai_prompt_library_revisions
    where source = 'roomi' and status = 'active'
    order by published_at desc nulls last
    limit 1
  `);
  if (!revisionResult.rows[0]) throw new Error('No active prompt library revision');
  const revision = revisionResult.rows[0];
  const categories = await client.query(`
    select source_id, parent_source_id, level, name, weight
    from app.ai_prompt_categories
    where import_revision_id = $1 and enabled = true
    order by level, weight desc, source_id
  `, [revision.id]);
  const templates = await client.query(`
    select t.id::text, t.source_id, t.name, t.prompt_content,
           t.category_source_id, c.name as category_name,
           t.parameter_template_source_id, t.best_model_source_id,
           t.weight, a.source_url, a.mime_type, a.width, a.height,
           a.storage_provider, a.storage_key
    from app.ai_prompt_templates t
    join app.ai_prompt_categories c on c.id = t.category_id
    left join app.ai_prompt_template_assets a on a.id = t.preview_asset_id
    where t.import_revision_id = $1 and t.enabled = true
    order by t.weight desc, t.source_id
  `, [revision.id]);
  const output = { revision, categories: categories.rows, templates: templates.rows };
  await fs.writeFile('C:/Users/Administrator/CodexTmp/ai-capability-enhancement-2026-08/prompt-library.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ revision, categoryCount: categories.rowCount, templateCount: templates.rowCount }, null, 2));
} finally {
  await client.end();
}
