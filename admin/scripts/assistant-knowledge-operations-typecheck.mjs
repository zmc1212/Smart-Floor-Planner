// Compare the same source program with the pre-KB4 baseline, retaining unrelated worktree files.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),base=process.argv[2]||'f2651bd6';
if(!/^[a-f0-9]{8,40}$/.test(base))throw Error('Expected an explicit commit hash');
const previous=['src/db/assistant-knowledge-schema.ts','src/db/repositories/assistant-cleanup.ts','src/app/(admin)/(merchant)/assistant-knowledge/page.tsx','src/components/assistant/client.ts','src/components/assistant/retrieval-diagnostics.tsx','src/lib/assistant/knowledge/diagnostics.ts'];
previous.push('src/lib/assistant/agent/synthesis.ts','src/lib/assistant/agent/worker.ts');
const added=['src/lib/assistant/knowledge/operations.ts','src/lib/assistant/knowledge/evaluation-check.ts','src/components/assistant/knowledge-operations.tsx','src/app/api/assistant/knowledge/operations/[...path]/route.ts','src/lib/assistant/__tests__/knowledge-evaluation.test.ts','src/db/__tests__/assistant-knowledge-operations.test.ts','scripts/assistant-knowledge-operations-development.ts'];
const config=ts.readConfigFile(root+'/tsconfig.json',ts.sys.readFile).config,parsed=ts.parseJsonConfigFileContent(config,ts.sys,root);parsed.options.incremental=false;parsed.options.tsBuildInfoFile=undefined;
const norm=f=>path.resolve(f).replaceAll('\\','/'),files=parsed.fileNames.filter(f=>!/[\\/]\.next[\\/]/.test(f));
const overrides=new Map(previous.map(f=>[norm(root+'/'+f),cp.execFileSync('git',['-C',path.resolve(root,'..'),'show',base+':admin/'+f],{encoding:'utf8'})]));
const read=(baseline)=>{const host=ts.createCompilerHost(parsed.options),raw=host.readFile.bind(host);host.readFile=f=>{
 let s=baseline?overrides.get(norm(f))??raw(f):raw(f);if(f.endsWith('next-env.d.ts'))s=s?.replace(/^import.*\.next.*$/gm,'');return s;
};return host;};
const removed=new Set(added.map(f=>norm(root+'/'+f)));
const before=ts.getPreEmitDiagnostics(ts.createProgram(files.filter(f=>!removed.has(norm(f))),parsed.options,read(true)));
const after=ts.getPreEmitDiagnostics(ts.createProgram(files,parsed.options,read(false)));
const key=d=>(d.file?.fileName||'')+'|'+d.code+'|'+ts.flattenDiagnosticMessageText(d.messageText,' '),oldKeys=new Set(before.map(key)),newKeys=new Set(after.map(key));
const result={base,scope:'source program; generated Next declarations excluded in both; unrelated worktree files retained',before:before.length,after:after.length,added:after.map(key).filter(k=>!oldKeys.has(k)),removed:before.map(key).filter(k=>!newKeys.has(k))};
const output=path.resolve(root,'../tmp/xiaok-kb4');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/type-comparison.json',JSON.stringify(result,null,2));
fs.writeFileSync(output+'/source-types.log',ts.formatDiagnosticsWithColorAndContext(after,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=>'\n'}));
console.log(JSON.stringify(result));if(result.added.length)process.exitCode=1;
