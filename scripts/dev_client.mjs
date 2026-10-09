// Dedicated loopback-only Vite server; ignore the public LAN development config.
import { createServer } from 'vite';
const [root, port, backend, token] = process.argv.slice(2);
const server = await createServer({
  configFile: false, root,
  plugins: [{ name: 'signalstudio-identity',
    // The local App must render even when Google Fonts is unreachable.
    transformIndexHtml(html) { return html.replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, ''); },
    configureServer(vite) {
    vite.middlewares.use('/__signalstudio_dev', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ project_root: root, token }));
    });
  } }],
  server: { host: '127.0.0.1', port: Number(port), strictPort: true,
    // FSEvents watches parent directories outside the selected security scope.
    watch: { usePolling: true, interval: 350, binaryInterval: 1000 },
    proxy: { '/api': `http://127.0.0.1:${backend}` } },
});
await server.listen();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await server.close(); process.exit(0); });
