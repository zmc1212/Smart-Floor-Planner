const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(miniRoot, 'project.config.json'), 'utf8'));
const normalize = value => value.replace(/\\/g, '/').toLowerCase();

function matches(file, rule) {
  const value = normalize(rule.value);
  switch (rule.type) {
    case 'file': return file === value;
    case 'folder': return file.startsWith(value.replace(/\/$/, '') + '/');
    case 'suffix': return file.endsWith(value);
    case 'prefix': return file.startsWith(value);
    case 'regexp': return new RegExp(rule.value, 'i').test(file);
    default: throw new Error('Unsupported packOptions rule in source budget: ' + rule.type);
  }
}

function isPackagedSource(file) {
  const normalized = normalize(file);
  // Official include rules take precedence over ignore rules.
  return (config.packOptions.include || []).some(rule => matches(normalized, rule))
    || !(config.packOptions.ignore || []).some(rule => matches(normalized, rule));
}

function packageSourceFiles(directory) {
  const root = path.join(miniRoot, directory || '');
  return fs.readdirSync(root, { recursive: true }).flatMap(file => {
    const absolute = path.join(root, file);
    const relative = path.relative(miniRoot, absolute).replace(/\\/g, '/');
    if (!fs.statSync(absolute).isFile() || !isPackagedSource(relative)) return [];
    return [{ absolute, relative, size: fs.statSync(absolute).size }];
  });
}

module.exports = { isPackagedSource, packageSourceFiles };
