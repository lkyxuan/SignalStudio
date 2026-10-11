// Bind only the explicitly selected loopback or private Tailscale interface.
import { createServer, preview } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
const [root, port, backend, token, host = '127.0.0.1', control = '18789'] = process.argv.slice(2);
const shared = host !== '127.0.0.1';
function configure(vite) {
  vite.middlewares.use((req, res, next) => {
    if (req.url?.startsWith('/api/') && req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`) {
      res.statusCode = 403;
      res.end('Cross-origin API requests are not allowed');
      return;
    }
    next();
  });
  if (shared) vite.middlewares.use((req, res, next) => {
    if (req.method !== 'GET' || req.url?.startsWith('/api/') || req.url?.startsWith('/__')) return next();
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const dist = resolve(root, 'dist');
    const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
    if (!file.startsWith(dist + sep) || !types[extname(file)] || !existsSync(file)) return next();
    const qualities = new Map((req.headers['accept-encoding'] || '').toLowerCase().split(',').map(item => {
      const [name, ...parameters] = item.trim().split(';');
      const q = Number(parameters.map(p => p.trim()).find(p => p.startsWith('q='))?.slice(2) ?? 1);
      return [name, Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
    }));
    let body = readFileSync(file);
    if (body.length >= 512 && (qualities.get('gzip') ?? qualities.get('*') ?? 0) > 0) {
      body = gzipSync(body); res.setHeader('Content-Encoding', 'gzip');
    }
    res.setHeader('Content-Type', types[extname(file)]);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('Content-Length', body.length);
    res.end(body);
  });
  vite.middlewares.use('/__signalstudio_dev', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ project_root: root, token }));
  });
}
const endpoints = { host, port: Number(port), strictPort: true,
  proxy: { '/api': `http://127.0.0.1:${backend}`,
    '/__signalstudio_health': { target: `http://127.0.0.1:${control}`, rewrite: () => '/health' } } };
const config = {
  configFile: false, root,
  plugins: [{ name: 'signalstudio-identity', configureServer: configure, configurePreviewServer: configure,
    transformIndexHtml(html) { return html.replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, ''); } }],
  server: { ...endpoints, watch: { usePolling: true, interval: 350, binaryInterval: 1000 } },
  preview: endpoints,
};
// Built pages contain no Vite reconnect client; a server update cannot reload drafts.
const server = shared ? await preview(config) : await createServer(config);
if (!shared) await server.listen();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (shared) await new Promise(resolve => server.httpServer.close(resolve));
  else await server.close();
  process.exit(0);
});
