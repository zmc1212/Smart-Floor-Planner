import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const admin = path.resolve(import.meta.dirname, '../..');
if (!process.argv[2]) throw new Error('Provide a directory for the gateway bundle and its source receipt');
const output = path.resolve(process.argv[2]);
const outfile = path.join(output, 'gateway.cjs');
const result = await build({
  absWorkingDir: admin,
  entryPoints: ['deployment/portfolio-kodo/gateway.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['pg', 'sharp', 'qiniu', 'aws4'],
  alias: { 'next/server': path.join(admin, 'deployment/camera-trial/next-server-entry.ts') },
  metafile: true,
});
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sources = Object.fromEntries(Object.keys(result.metafile.inputs)
  .filter(file => !file.startsWith('node_modules/')).map(file => [file, sha256(path.join(admin, file))]));
const receipt = { sources, bundleSha256: sha256(outfile), bytes: fs.statSync(outfile).size, aws4: '1.13.2' };
fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ files: Object.keys(sources).length, bytes: receipt.bytes, sha256: receipt.bundleSha256 }));
