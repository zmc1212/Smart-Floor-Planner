import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import pg from 'pg';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
const root = path.resolve(import.meta.dirname, '..'); process.chdir(root); nextEnv.loadEnvConfig(root, true);
const evidence = process.argv.find(arg => arg.startsWith('--evidence='))?.slice('--evidence='.length) || 'xiaok-d3-portfolio-contact';
if (!/^xiaok-[a-z0-9-]{1,80}$/.test(evidence)) throw Error('Invalid evidence name');
const output = path.resolve('../tmp', evidence); fs.mkdirSync(output, { recursive: true });
const config = JSON.parse(fs.readFileSync('../tmp/xiaok-vector/connection.private.json', 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = config.DATABASE_URL;
const release = await lockAssistantAcceptance(process.env.DATABASE_URL, { waitForLock: process.argv.includes('--wait-for-lock') });
const metadata = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await metadata.connect();
  const schema = async () => {
    const row = (await metadata.query(`select current_database() as database,
      (select oid::text from pg_database where datname=current_database()) as database_id,
      has_schema_privilege(current_user,'app','CREATE') as can_create_app,
      has_database_privilege(current_user,current_database(),'CREATE') as can_create_schema,
      r.rolsuper,r.rolbypassrls from pg_roles r where r.rolname=current_user`)).rows[0];
    const required = ['app.portfolio_portraits', 'assistant_requirement_workflow.checkpoints', 'assistant_requirement_workflow.checkpoint_blobs', 'assistant_requirement_workflow.checkpoint_writes'];
    const tables = (await metadata.query('select name,to_regclass(name)::text as actual from unnest($1::text[]) as name', [required])).rows;
    return { ...row, tables };
  };
  const configuration = await schema();
  fs.writeFileSync(path.join(output, 'configuration-start.json'), JSON.stringify(configuration, null, 2));
  const missing = configuration.tables.filter(table => !table.actual).map(table => table.name);
  if (missing.length) {
    fs.writeFileSync(path.join(output, 'status.json'), JSON.stringify({ exitCode: 2, status: 'blocked_test_schema', missing, configuration,
      limits: 'No schema change, migration-role credential access or test fixture write attempted; this is not a business acceptance run.' }, null, 2));
    console.log('Blocked isolated schema: ' + missing.join(', ')); process.exitCode = 2;
  } else {
  process.env.ASSISTANT_PORTFOLIO_CONTACT_EVIDENCE = output;
  const files = [];
  const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = folder + '/' + entry.name; if (entry.isDirectory()) walk(file); else if (/\.(ts|js|mjs)$/.test(file)) files.push(file);
  } };
  for (const folder of ['src/lib/assistant', 'src/lib/portfolio', 'src/db']) walk(folder);
  files.push('scripts/assistant-portfolio-contact-acceptance.mjs', 'scripts/assistant-acceptance-safety.mjs', 'src/lib/postgresql.ts', 'src/lib/miniprogram-jwt.ts', 'package.json', 'package-lock.json', 'tsconfig.json');
  const hashes = () => Object.fromEntries(files.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  const started = new Date().toISOString(), sources = hashes();
  const args = ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=180000', ...(process.argv.includes('--repro') ? ['--test-name-pattern=^D3 signed'] : []), 'src/db/__tests__/assistant-portfolio-contact.test.ts'];
  fs.writeFileSync(path.join(output, 'start.json'), JSON.stringify({ started, sources, args }, null, 2));
  const file = path.join(output, 'service.log'); fs.writeFileSync(file, ''); let log = '';
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = c => { log += c; fs.appendFileSync(file, c); }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  const testExitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  const sourcesAfter = hashes(), changedDuringRun = files.filter(file => sources[file] !== sourcesAfter[file]);
  const configurationAfter = await schema(), configurationChanged = JSON.stringify(configuration) !== JSON.stringify(configurationAfter);
  const exitCode = testExitCode || Number(changedDuringRun.length > 0 || configurationChanged);
  fs.writeFileSync(path.join(output, 'status.json'), JSON.stringify({ started, finished: new Date().toISOString(), sources, sourcesAfter, changedDuringRun, configuration, configurationAfter, configurationChanged, testExitCode, exitCode, model: 'zero provider/model/embedding calls; real isolated auth/publication/graph writes only; no native acceptance' }, null, 2));
  console.log(log.split('\n').filter(line => /^(# (tests|pass|fail|skip)|not ok|ok \d|  error:|  message:)/.test(line)).slice(-20).join('\n'));
  process.exitCode = exitCode;
  }
} finally { await metadata.end().catch(() => {}); await release(); }
