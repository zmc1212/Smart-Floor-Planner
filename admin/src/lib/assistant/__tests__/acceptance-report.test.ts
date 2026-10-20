import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeAcceptanceReport } from '../../../../scripts/assistant-acceptance-report.mjs';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-report-'));
  const file = path.join(directory, 'report.json');
  fs.writeFileSync(file, JSON.stringify({ original: true }));
  return { file, cleanup() {
    for (const name of ['report.json', 'report.json.next']) {
      const owned = path.join(directory, name); if (fs.existsSync(owned)) fs.unlinkSync(owned);
    }
    fs.rmdirSync(directory);
  } };
}

test('transient report sharing violations preserve the original until the same payload commits', t => {
  const { file, cleanup } = fixture(), rename = fs.renameSync;
  let attempts = 0;
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    attempts++;
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { original: true });
    if (attempts < 3) throw Object.assign(new Error('synthetic sharing violation'), { code: 'EPERM' });
    return rename(from, to);
  });
  try {
    writeAcceptanceReport(file, { completed: true });
    assert.equal(attempts, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { completed: true });
    assert.equal(fs.existsSync(file + '.next'), false);
  } finally { t.mock.restoreAll(); cleanup(); }
});

test('persistent report failures stay bounded and retain both original and uncommitted payload', t => {
  const { file, cleanup } = fixture(); let attempts = 0;
  t.mock.method(fs, 'renameSync', () => { attempts++; throw Object.assign(new Error('synthetic persistent denial'), { code: 'EACCES' }); });
  try {
    assert.throws(() => writeAcceptanceReport(file, { completed: true }), /persistent denial/);
    assert.equal(attempts, 5);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { original: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file + '.next', 'utf8')), { completed: true });
  } finally { t.mock.restoreAll(); cleanup(); }
});
