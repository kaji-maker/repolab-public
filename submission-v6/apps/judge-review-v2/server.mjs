import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frontend, selected } from './contract.mjs';
import { loadRelease } from './integrity.mjs';

export async function startReviewServer(root, digest, port = 4187) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024)) throw Error('Invalid local port');
  // Hold verified bytes in memory. Later disk changes cannot alter an already running response.
  const { files, review } = await loadRelease(root, digest);
  const api = '/api/native-preact-repairs-v4';
  const catalog = Buffer.from(JSON.stringify({
    readiness: { available: false, reason: 'Portable recorded review only. This build makes no new model calls or Sandbox operations; fresh execution is unavailable.' },
    history: [review], profile: 'preactjs__preact-4436', engine: 'V4',
    evidence: 'Recorded actual October 25 browser V2 result; no new execution in this review build',
  }));
  const server = createServer((req, res) => {
    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const origins = hosts.map(host => `http://${host}`);
    if (!hosts.includes(req.headers.host) || (req.headers.origin && !origins.includes(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403); res.end('Local access only'); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Recorded review only; execution unavailable'); return;
    }
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 2048) {
      res.writeHead(400); res.end('Invalid request path'); return;
    }
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;
    let bytes, type = 'text/plain', attachment;
    if (path === api || path === `${api}/`) { bytes = catalog; type = 'application/json'; }
    else if (path === `${api}/${selected.id}`) { bytes = files.get('data/review.json'); type = 'application/json'; }
    else if (path === `${api}/${selected.id}/patch`) {
      bytes = files.get('data/patch.patch'); attachment = `preact-${selected.id}.patch`;
    } else {
      const file = path === '/' ? 'native-repair-v9.html' : path.slice(1);
      if (![...Object.keys(frontend), 'data/result.json', 'data/review.json', 'data/patch.patch', 'README.md',
        'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PREACT_LICENSE.txt', 'REACT_LICENSE.txt', 'REACT_DOM_LICENSE.txt', 'SCHEDULER_LICENSE.txt'].includes(file)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      bytes = files.get(file);
      type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' :
        file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.json') ? 'application/json' : 'text/plain';
    }
    res.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`, 'Content-Length': bytes.length,
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      ...(attachment ? { 'Content-Disposition': `attachment; filename="${attachment}"` } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startReviewServer(dirname(fileURLToPath(import.meta.url)), process.argv[2], Number(process.argv[3] ?? 4187));
  console.log(`ReproLab recorded qualified product: http://127.0.0.1:${server.address().port}`);
  console.log('Inference: none. Execution: local recorded review only; fresh provider execution unavailable.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
