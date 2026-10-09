// Usage: NODE_PATH=/path/to/sharp/node_modules node design/logo/render_png.cjs
const sharp = require('sharp');
const path = require('node:path');

(async () => {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : ['logo-review', 'a-app-icon', 'b-app-icon']) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid asset name');
    await sharp(path.join(__dirname, `${name}.svg`)).png().toFile(path.join(__dirname, `${name}.png`));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
