import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import ts from 'typescript';

const admin=path.resolve(import.meta.dirname,'..'),root=path.dirname(admin),base=process.argv[2]||'34d57f53cbdb0db152df637901eda26abdc469c1';
if(!/^[a-f0-9]{8,40}$/.test(base))throw Error('Explicit integration baseline SHA required');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const changed=[...new Set([...git('diff','--name-only',base,'--','admin').split('\n'),...git('ls-files','--others','--exclude-standard','--','admin').split('\n')])]
  .filter(f=>/\.(ts|tsx)$/.test(f));
const normalize=f=>path.resolve(f).replaceAll('\\','/'),overrides=new Map(),added=new Set();
for(const file of changed){const old=cp.spawnSync('git',['show',base+':'+file],{cwd:root,encoding:'utf8'});if(old.status===0)overrides.set(normalize(path.join(root,file)),old.stdout);else added.add(normalize(path.join(root,file)));}
const manifest=()=>changed.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const initial=manifest();
const config=ts.readConfigFile(path.join(admin,'tsconfig.json'),ts.sys.readFile).config;
const parsed=ts.parseJsonConfigFileContent(config,ts.sys,admin);parsed.options.incremental=false;parsed.options.tsBuildInfoFile=undefined;
const files=parsed.fileNames.filter(file=>!/[\\/]\.next[\\/]/.test(file));
function host(baseline){const h=ts.createCompilerHost(parsed.options),read=h.readFile.bind(h);h.readFile=file=>{let text=baseline?(overrides.get(normalize(file))??read(file)):read(file);if(file.endsWith('next-env.d.ts'))text=text?.replace(/^import.*\.next.*$/gm,'');return text;};return h;}
const before=ts.getPreEmitDiagnostics(ts.createProgram(files.filter(file=>!added.has(normalize(file))),parsed.options,host(true)));
const after=ts.getPreEmitDiagnostics(ts.createProgram(files,parsed.options,host(false)));
const key=d=>(d.file?.fileName||'')+'|'+d.code+'|'+ts.flattenDiagnosticMessageText(d.messageText,' '),old=new Set(before.map(key)),current=new Set(after.map(key));
const result={base,scope:'identical integration program excluding generated Next declarations; current shared files reverted, new files omitted only in baseline',before:before.length,after:after.length,added:after.map(key).filter(k=>!old.has(k)),removed:before.map(key).filter(k=>!current.has(k)),sourceManifest:initial,changedDuringRun:JSON.stringify(initial)!==JSON.stringify(manifest())};
const output=path.join(root,'tmp/xiaok-execution-fence');fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'type-comparison.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(output,'source-types.log'),ts.formatDiagnosticsWithColorAndContext(after,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>admin,getNewLine:()=>'\n'}));
console.log(JSON.stringify({base,before:result.before,after:result.after,added:result.added,changedDuringRun:result.changedDuringRun}));
if(result.added.length||result.changedDuringRun)process.exitCode=1;
