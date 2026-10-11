import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
let revision: string | null = null;
let dirty = false;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // The live SQLite database is runtime state, never part of the UI build.
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' });
  dirty = changes.split('\n').some(line => line && !/^data\/logic\.db(?:-wal|-shm)?$/.test(line.slice(3)));
} catch { /* Non-Git builds must say unknown. */ }
const build = { revision, dirty };

export default defineConfig({
  define: { __SIGNALSTUDIO_BUILD__: JSON.stringify(build) },
  plugins: [{ name: 'signalstudio-build-version', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(build) });
  } }],
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
