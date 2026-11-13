import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { AssistantError, id } from '@/lib/assistant/contracts';
import { customerIdentity, locate } from '@/lib/assistant/application/auth';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { loadKodoCredentials, objectKey, signedKodoUrl } from './signing';

const route = /^\/api\/miniprogram\/assistant\/conversations\/(\d+)\/portfolio\/works\/(\d+)\/assets\/(\d+)\/kodo$/;
const bucket = process.env.PORTFOLIO_KODO_BUCKET;
if (!bucket) throw new Error('Missing private portfolio storage configuration');
const credentials = loadKodoCredentials();
credentials.catch(() => { console.error('Portfolio storage initialization failed'); process.exitCode = 1; server.close(); });

const server = createServer(async (incoming, outgoing) => {
  outgoing.setHeader('Cache-Control', 'private, no-store');
  outgoing.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(incoming.url || '/', 'http://localhost');
  if (incoming.method === 'GET' && url.pathname === '/healthz') {
    await credentials.then(() => outgoing.writeHead(200).end(), () => outgoing.writeHead(503).end());
    return;
  }
  const match = route.exec(url.pathname);
  if (incoming.method !== 'GET' || !match || url.searchParams.size !== 1 || !url.searchParams.has('versionId')) {
    outgoing.writeHead(404).end();
    return;
  }
  try {
    const request = new Request(url, { headers: { authorization: incoming.headers.authorization || '' } });
    const identity = await customerIdentity(request);
    const [, conversationId, workId, assetId] = match;
    const actor = await locate(identity, 'conversation', id(conversationId));
    if (actor.enterpriseId !== '1' || !/^([1-9]|1[0-2])$/.test(workId)) {
      outgoing.writeHead(404).end();
      return;
    }
    const hash = await new PortfolioCatalog(actor, conversationId).imageHash(workId, id(url.searchParams.get('versionId')), assetId);
    const signedUrl = signedKodoUrl({ bucket, key: objectKey(workId, assetId, hash), credentials: await credentials });
    const upstream = await fetch(signedUrl, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (upstream.status === 404) {
      await upstream.body?.cancel();
      outgoing.writeHead(404).end();
      return;
    }
    if (!upstream.ok || !upstream.body || upstream.headers.get('content-type') !== 'image/jpeg') {
      await upstream.body?.cancel();
      outgoing.writeHead(502).end();
      return;
    }
    outgoing.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Portfolio-Image-Source': 'kodo' });
    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on('error', () => outgoing.destroy());
    outgoing.on('close', () => stream.destroy());
    stream.pipe(outgoing);
  } catch (error) {
    if (!outgoing.headersSent) outgoing.writeHead(error instanceof AssistantError ? error.status : 503).end();
    else outgoing.destroy();
  }
}).listen(33419, '0.0.0.0');
