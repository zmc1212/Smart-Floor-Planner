import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
/** Static local import closure plus pinned dependencies/config, fixed before a run. */
export function bindPublicLive(seeds){
  const root=path.resolve('..'),seen=new Set(),files={};
  const visit=p=>{
    p=path.resolve(p);if(seen.has(p)||!fs.existsSync(p)||!fs.statSync(p).isFile())return;seen.add(p);
    const bytes=fs.readFileSync(p);files[path.relative(root,p).replaceAll('\\','/')]=hash(bytes);
    if(!/\.(?:[cm]?js|tsx?)$/.test(p))return;
    const s=bytes.toString('utf8'),refs=[...s.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
    for(const ref of refs){
      if(!ref.startsWith('.')&&!ref.startsWith('@/'))continue;
      const base=ref.startsWith('@/')?path.join(root,'admin/src',ref.slice(2)):path.resolve(path.dirname(p),ref);
      const options=[base,...['.ts','.tsx','.js','.mjs','.cjs','/index.ts','/index.js'].map(x=>base+x)];
      const found=options.find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found)visit(found);
    }
  };
  for(const p of [...seeds,'admin/package.json','admin/package-lock.json','admin/tsconfig.json','admin/next.config.ts'])visit(path.resolve(root,p));
  const config={};for(const k of ['DATABASE_URL','JWT_SECRET','CAMERA_WVP_ORIGIN','CAMERA_MEDIA_ORIGIN','PUBLIC_LIVE_ZLM_ORIGIN','PUBLIC_LIVE_SOURCE_ORIGIN','PUBLIC_LIVE_ZLM_SECRET','PUBLIC_LIVE_PUBLIC_ORIGIN'])config[k]=hash(process.env[k]||'');
  return {files,config,scope:'Actual local import closure of fixed services/routes/driver; node_modules bound by package lock. No unused camera controller/soak or model calls.'};
}
export function comparePublicLive(before){
  const root=path.resolve('..'),drift=[];
  for(const [p,want]of Object.entries(before.files)){const f=path.join(root,p);const got=fs.existsSync(f)?hash(fs.readFileSync(f)):null;if(got!==want)drift.push(p);}
  for(const [k,want]of Object.entries(before.config))if(hash(process.env[k]||'')!==want)drift.push('config:'+k);
  return drift;
}
