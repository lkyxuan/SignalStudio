// Usage: NODE_PATH=/path/to/sharp/node_modules node design/logo/render_png.cjs
const sharp = require('sharp');
const path = require('node:path');

(async () => {
  for (const name of ['logo-review', 'a-app-icon', 'b-app-icon']) {
    await sharp(path.join(__dirname, `${name}.svg`)).png().toFile(path.join(__dirname, `${name}.png`));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
