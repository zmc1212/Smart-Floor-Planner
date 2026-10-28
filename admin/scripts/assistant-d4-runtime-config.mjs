import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Pin the actual tsx input; concurrent Next builds may append generated-type
 * include paths to the developer's tsconfig. Never edit that shared file. */
export function freezeD4RuntimeConfig(admin, destination) {
  const source = path.join(admin, 'tsconfig.json'), raw = fs.readFileSync(source, 'utf8');
  const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
  config.compilerOptions.baseUrl = admin;
  config.compilerOptions.paths = Object.fromEntries(Object.entries(config.compilerOptions.paths || {}).map(([key, values]) =>
    [key, values.map(value => path.resolve(admin, value))]));
  if (config.extends) config.extends = path.resolve(admin, config.extends);
  for (const field of ['include', 'exclude', 'files']) if (config[field]) config[field] = config[field].map(value => path.resolve(admin, value));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(config, null, 2));
  const hash = value => createHash('sha256').update(value).digest('hex');
  return { source, sourceHash: hash(raw), runtimeConfig: destination, runtimeHash: hash(fs.readFileSync(destination)) };
}
