import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const protocol = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'contract.json'), 'utf8'));
const definition = protocol.tools[0], skills = path.join(root, 'tmp/anythingllm-pilot/storage/plugins/agent-skills');
// The single owned pilot must be idle under the acceptance lock before mutation.
for (const name of ['sfp-comparison-business', 'sfp-comparison-search', 'sfp-renovation-business', 'sfp-renovation-context']) {
  const file = path.join(skills, name, 'plugin.json'); if (!fs.existsSync(file)) continue;
  const previous = JSON.parse(fs.readFileSync(file, 'utf8')); previous.active = false; fs.writeFileSync(file, JSON.stringify(previous, null, 2));
}
const directory = path.join(skills, definition.name); fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify({ active: true, hubId: definition.name, name: definition.name,
  schema: 'skill-1.0.0', version: '2.0.0', description: definition.description, setup_args: {},
  entrypoint: { file: 'handler.js', params: definition.parameters.properties } }, null, 2));
fs.copyFileSync(path.join(import.meta.dirname, 'contract-handler.cjs'), path.join(directory, 'handler.js'));
console.log(JSON.stringify({ prepared: definition.name, nativeRuntimeUnchanged: true }));
