import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import tls from 'node:tls';

const report = { pid: process.pid, databaseConnections: 0, compilerPipes: 0, providerFetches: 0, blockedSockets: 0 };
let databaseAllowed = process.env.XIAOK_SEAM_DATABASE_ALLOWED === '1';
export function allowDatabase() { databaseAllowed = true; }
export function networkReport() { return { ...report }; }
globalThis.fetch = async () => { report.providerFetches++; throw Error('SEAM_EXTERNAL_HTTP_BLOCKED'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let input = args[0];
  if (Array.isArray(input)) input = input[0];
  const options = input && typeof input === 'object' ? input : {};
  const port = Number(options.port ?? (typeof input === 'number' ? input : NaN));
  const host = options.host ?? args[1];
  if (databaseAllowed && port === 55432 && ['localhost', '127.0.0.1', '::1'].includes(host)) {
    report.databaseConnections++; return connect.apply(this, args);
  }
  const pipe = options.path ?? (typeof input === 'string' ? input : '');
  const directory = path.join(os.tmpdir(), 'tsx-' + (process.geteuid?.() ?? os.userInfo().username));
  const candidates = [process.pid, process.ppid].map(pid => path.join(directory, pid + '.pipe'));
  // tsx uses an exact current/parent process pipe; no broad named-pipe/TCP exception.
  if (process.platform === 'win32' && candidates.some(candidate => pipe === '\\\\?\\pipe\\' + candidate)
    || process.platform !== 'win32' && candidates.includes(pipe)) {
    report.compilerPipes++; return connect.apply(this, args);
  }
  report.blockedSockets++; throw Error('SEAM_EXTERNAL_SOCKET_BLOCKED');
};
const secureConnect = tls.connect;
tls.connect = function (...args) {
  const input = args[0] && typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  if (databaseAllowed && Number(input.port) === 55432 && ['localhost', '127.0.0.1', '::1'].includes(input.host)) return secureConnect.apply(this, args);
  report.blockedSockets++; throw Error('SEAM_EXTERNAL_TLS_BLOCKED');
};
process.once('exit', () => {
  if (process.env.XIAOK_SEAM_GUARD_REPORT) fs.writeFileSync(process.env.XIAOK_SEAM_GUARD_REPORT, JSON.stringify(report, null, 2));
});
