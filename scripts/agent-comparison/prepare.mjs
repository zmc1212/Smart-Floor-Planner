import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const protocol = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'protocol.json'), 'utf8'));
const handler = fs.readFileSync(path.join(import.meta.dirname, 'handler.cjs'), 'utf8');
for (const def of protocol.tools) {
  const dir = path.join(root, 'tmp/anythingllm-pilot/storage/plugins/agent-skills', def.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ active: true, hubId: def.name, name: def.name,
    schema: 'skill-1.0.0', version: '1.0.0', description: def.description, setup_args: {},
    entrypoint: { file: 'handler.js', params: def.parameters.properties } }, null, 2));
  // The name comes from the installed skill, never from model arguments.
  fs.writeFileSync(path.join(dir, 'handler.js'), handler.replace('this.config?.hubId || this.__comparisonName', JSON.stringify(def.name)));
}
console.log(JSON.stringify({ prepared: true, skills: protocol.tools.map(t => t.name), baselineSkillUnchanged: true }));
