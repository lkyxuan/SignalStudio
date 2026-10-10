// Bind only the explicitly selected loopback or private Tailscale interface.
import { createServer, preview } from 'vite';
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
