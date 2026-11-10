import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const admin=path.resolve(import.meta.dirname,'../..');
const out=path.resolve(process.argv[2]||'../tmp/cloud-camera-production-20261106');
fs.mkdirSync(out,{recursive:true});
const result=await build({absWorkingDir:admin,entryPoints:['scripts/construction-camera-gateway.ts'],outfile:path.join(out,'gateway.cjs'),
  bundle:true,platform:'node',target:'node20',format:'cjs',tsconfig:path.join(admin,'tsconfig.json'),
  alias:{'next/server':path.join(import.meta.dirname,'next-server-entry.ts')},external:['pg','sharp'],metafile:true,logLevel:'silent'});
const bindings={};
for(const input of Object.keys(result.metafile.inputs)){
 const file=path.resolve(admin,input);bindings[input]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
fs.writeFileSync(path.join(out,'gateway-build.json'),JSON.stringify({target:'node20',bindings,metafile:result.metafile}));
console.log(JSON.stringify({inputs:Object.keys(bindings).length,bytes:Object.values(result.metafile.outputs)[0].bytes,bundleSha256:createHash('sha256').update(fs.readFileSync(path.join(out,'gateway.cjs'))).digest('hex')}));
