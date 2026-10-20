import fs from 'node:fs';

/** Keep the previous complete report readable while a Windows reader briefly
 * holds the destination. Retry only this same atomic commit, never its work. */
export function writeAcceptanceReport(file, report) {
  const next = file + '.next';
  fs.writeFileSync(next, JSON.stringify(report, null, 2));
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(next, file); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt >= 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** attempt);
    }
  }
}
