import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import nextEnv from '@next/env';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);nextEnv.loadEnvConfig(root,true);
const output=path.resolve('../tmp/xiaok-kb4');fs.mkdirSync(output,{recursive:true});
const mode=['unit','regression','synthesis','unready','mini','lint','types','build','compile'].find(m=>process.argv.includes('--'+m))||'service';
let release=async()=>{};
if(['service','regression','synthesis','unready'].includes(mode)){const config=JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json','utf8').replace(/^\uFEFF/,''));process.env.DATABASE_URL=config.DATABASE_URL;release=await lockAssistantAcceptance();}
try{
const files=mode==='unit'?['src/lib/assistant/__tests__/knowledge-evaluation.test.ts','src/lib/assistant/__tests__/context-selection.test.ts','src/lib/assistant/__tests__/source-file.test.ts']:
 mode==='regression'?['src/db/__tests__/assistant-professional-knowledge.test.ts','src/db/__tests__/assistant-source-file.test.ts','src/db/__tests__/assistant-usage.test.ts','src/db/__tests__/assistant-platform-access.test.ts','src/db/__tests__/assistant-operations.test.ts','src/db/__tests__/assistant-knowledge.test.ts']:
 mode==='synthesis'?['src/db/__tests__/assistant-synthesis.test.ts','src/db/__tests__/assistant-agent.test.ts','src/db/__tests__/assistant-materials.test.ts']:['src/db/__tests__/assistant-knowledge-operations.test.ts'];
const args=mode==='lint'?['node_modules/eslint/bin/eslint.js','.']:mode==='types'?['node_modules/typescript/bin/tsc','--noEmit','--incremental','false']:
 ['build','compile'].includes(mode)?['node_modules/next/dist/bin/next','build','--webpack',...(mode==='compile'?['--experimental-build-mode','compile']:[])]:mode==='mini'?['--test',...fs.readdirSync('../miniprogram/test').filter(f=>f.startsWith('assistant-')&&f.endsWith('.test.js')).map(f=>'../miniprogram/test/'+f)]:
 ['--import','tsx','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000',...(mode==='unready'?['--test-name-pattern=K11 an unready index']:[]),...files];
let log='';const file=path.join(output,mode+'.log');fs.writeFileSync(file,'');
let executionRoot=root;
if(['build','compile'].includes(mode)){
 executionRoot=path.resolve(root,'../tmp/xiaok-kb4-build');fs.mkdirSync(executionRoot,{recursive:true});
 const marker=path.join(executionRoot,'snapshot-owner.json');if(fs.existsSync(marker)&&JSON.parse(fs.readFileSync(marker,'utf8')).root!==root)throw Error('Build snapshot belongs to another workspace');
 fs.writeFileSync(marker,JSON.stringify({root,scope:'isolated build snapshot; existing worktree, not a clean-clone proof'}));
 const copy=(source,target)=>{const stat=fs.lstatSync(source);if(stat.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const name of fs.readdirSync(source))copy(path.join(source,name),path.join(target,name));}else if(stat.isFile())fs.copyFileSync(source,target);else throw Error('Unexpected linked source in build snapshot');};
 for(const name of ['src','scripts','assets','package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.ts','postcss.config.mjs'])copy(path.join(root,name),path.join(executionRoot,name));
 if(!fs.existsSync(path.join(executionRoot,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(executionRoot,'node_modules'),'junction');
}
const child=spawn(process.execPath,args,{cwd:executionRoot,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const s of [child.stdout,child.stderr])s.on('data',c=>{log+=c;fs.appendFileSync(file,c);});
const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',c=>resolve(c??1));});
fs.writeFileSync(path.join(output,mode+'-status.json'),JSON.stringify({exitCode,finished:new Date().toISOString(),model:['service','regression','synthesis','unready'].includes(mode)?'deterministic model, real isolated database/embedding':'not a real-model evaluation'}));
console.log(log.split('\n').filter(l=>/^# (tests|pass|fail|skip)|^not ok|error:|error TS.*|Error:|✖/.test(l)).slice(-40).join('\n')||`${mode}: exit ${exitCode}`);process.exitCode=exitCode;
}finally{await release();}
