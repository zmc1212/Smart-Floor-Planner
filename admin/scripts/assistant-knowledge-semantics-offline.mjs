import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

// No environment loader, connection file, database lock, provider or Worker entry point.
const root = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2), i = args.indexOf('--output-dir');
if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw Error('Missing --output-dir value');
const output = path.resolve(root, i < 0 ? '../tmp/knowledge-semantics/offline' : args[i + 1]);
fs.mkdirSync(output, { recursive: true });
const files = ['src/lib/assistant/__tests__/knowledge-semantic-acceptance.test.ts', 'src/lib/assistant/__tests__/knowledge-context-coverage.test.ts',
  'src/lib/assistant/__tests__/context-selection.test.ts', 'src/lib/assistant/__tests__/knowledge-evaluation.test.ts',
  'src/lib/assistant/__tests__/professional-knowledge.test.ts', 'src/lib/assistant/__tests__/synthesis.test.ts'];
const sources = [...files, 'scripts/assistant-knowledge-semantic-rules.ts', 'scripts/assistant-knowledge-semantics-offline.mjs', 'scripts/fixtures/assistant-knowledge-semantic-counterexamples.json',
  'src/lib/assistant/knowledge/context-selection.ts', 'src/lib/assistant/knowledge/evaluation-check.ts',
  'src/lib/assistant/agent/synthesis.ts', 'src/lib/ai/providers/agent-chat.ts', 'src/lib/assistant/contracts/model.ts'];
const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
const guardPrefix = 'offline-guard-' + randomUUID(), guard = path.join(output, guardPrefix + '.cjs');
fs.writeFileSync(guard, `const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const calls={fetch:0,socket:0,tls:0},attempts=[],ipc=[];
const pipeDir=path.join(os.tmpdir(),'tsx-'+(process.geteuid?.()??os.userInfo().username));
const compilerPipes=new Set([process.pid,process.ppid].map(pid=>(process.platform==='win32'?'\\\\\\\\?\\\\pipe\\\\':'')+path.join(pipeDir,pid+'.pipe')));
const reject=(kind,args=[])=>{calls[kind]++;const a=args[0],b=Array.isArray(a)?a[0]:a;attempts.push({kind,destination:typeof b==='object'&&b?{path:b.path,host:b.host,port:b.port}:typeof b==='string'?{path:b}:{type:typeof b},stack:new Error().stack.split('\\n').slice(1,7)});throw Error('Knowledge offline acceptance forbids network: '+kind);};
globalThis.fetch=async()=>reject('fetch');
const connect=require('node:net').Socket.prototype.connect;
require('node:net').Socket.prototype.connect=function(...args){const a=args[0],b=Array.isArray(a)?a[0]:a,p=typeof b==='string'?b:b?.path;if(compilerPipes.has(p)){ipc.push(p);return connect.apply(this,args);}return reject('socket',args);};
require('node:tls').connect=function(...args){return reject('tls',args);};
process.on('exit',()=>fs.writeFileSync(${JSON.stringify(path.join(output, guardPrefix))}+'-'+process.pid+'.json',JSON.stringify({pid:process.pid,calls,attempts,compilerIpc:ipc})));
`);
const before = hashes(), logfile = path.join(output, 'unit.log'); fs.writeFileSync(logfile, '');
const child = spawn(process.execPath, ['--require', guard, '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1',
  '--test-timeout=60000', ...files], { cwd: root, env: { ...process.env, LANGCHAIN_TRACING_V2: 'false' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { log += value; fs.appendFileSync(logfile, value); });
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
const after = hashes(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
const networkGuards = fs.readdirSync(output).filter(file => file.startsWith(guardPrefix + '-') && file.endsWith('.json'))
  .map(file => JSON.parse(fs.readFileSync(path.join(output, file), 'utf8')));
const networkAttempts = networkGuards.reduce((n, g) => n + g.calls.fetch + g.calls.socket + g.calls.tls, 0);
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped'].map(name => [name, Number(log.match(new RegExp(`^# ${name} ([0-9]+)`, 'm'))?.[1] || 0)]));
const runnerExitCode = exitCode || (sourceStable && summary.tests > 0 && networkGuards.length > 0 && networkAttempts === 0 ? 0 : 1);
const result = { exitCode, runnerExitCode, sourceStable, summary, networkAttempts, networkGuards, before, after, finished: new Date().toISOString(),
  reality: 'Offline counterexample rejection and simulated positive ports; no model, Embedding, database, queue or production fix acceptance',
  semanticCorrectness: 'Only declared invariants are checked; broader source-bound review remains required' };
fs.writeFileSync(path.join(output, 'unit-status.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ exitCode, runnerExitCode, sourceStable, ...summary, networkAttempts, guardedProcesses: networkGuards.length }));
if (exitCode) console.log(log.split('\n').filter(line => /^not ok|^  error:|^  code:/.test(line)).join('\n'));
process.exitCode = runnerExitCode;
