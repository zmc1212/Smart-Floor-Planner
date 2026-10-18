// Same source program on both sides; keep unrelated worktree content and exclude generated Next declarations.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..'), base = process.argv[2] || '9210a012';
if (!/^[a-f0-9]{8,40}$/.test(base)) throw Error('Expected an explicit baseline commit');
const previous = ['src/lib/construction/site-issues.ts','src/lib/construction/site-results.ts','src/lib/construction/need-issues.ts',
  'src/lib/construction/site-chat.ts','src/lib/assistant/agent/context.ts','src/db/__tests__/construction-resolution.test.ts','src/db/__tests__/construction-materials.test.ts'];
const added = ['src/db/__tests__/construction-issue-continuation.test.ts','scripts/construction-issue-continuation-development.ts','scripts/construction-issue-continuation-audit.ts'];
const config = ts.readConfigFile(root + '/tsconfig.json', ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root); parsed.options.incremental = false; parsed.options.tsBuildInfoFile = undefined;
const norm = f => path.resolve(f).replaceAll('\\','/'), files = parsed.fileNames.filter(f => !/[\\/]\.next[\\/]/.test(f));
const overrides = new Map(previous.map(f => [norm(root + '/' + f), cp.execFileSync('git', ['-C',path.resolve(root,'..'),'show',base + ':admin/' + f], { encoding: 'utf8' })]));
const host = baseline => {
  const value = ts.createCompilerHost(parsed.options), read = value.readFile.bind(value);
  value.readFile = f => { let s = baseline ? overrides.get(norm(f)) ?? read(f) : read(f);
    if (f.endsWith('next-env.d.ts')) s = s?.replace(/^import.*\.next.*$/gm,''); return s; }; return value;
};
const omitted = new Set(added.map(f => norm(root + '/' + f)));
const before = ts.getPreEmitDiagnostics(ts.createProgram(files.filter(f => !omitted.has(norm(f))), parsed.options, host(true)));
const after = ts.getPreEmitDiagnostics(ts.createProgram(files, parsed.options, host(false)));
const key = d => (d.file?.fileName || '') + '|' + d.code + '|' + ts.flattenDiagnosticMessageText(d.messageText,' ');
const oldKeys = new Set(before.map(key)), newKeys = new Set(after.map(key));
const result = { base, scope: 'identical source program excluding generated Next declarations, unrelated worktree preserved', before: before.length, after: after.length,
  added: after.map(key).filter(k => !oldKeys.has(k)), removed: before.map(key).filter(k => !newKeys.has(k)) };
const output = path.resolve(root, '../tmp/xiaok-issue-continuation'); fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output + '/type-comparison.json', JSON.stringify(result,null,2));
fs.writeFileSync(output + '/source-types.log', ts.formatDiagnosticsWithColorAndContext(after,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=>'\n'}));
console.log(JSON.stringify(result)); if (result.added.length) process.exitCode = 1;
