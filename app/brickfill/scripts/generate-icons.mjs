// Renders the BrickFill raster icons from the SVG mark in client/public (run with `npm run icons`).
// The SVGs are the source of truth; commit the generated PNGs so the build needs no image tooling.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/public');
const mark = await readFile(path.join(publicDir, 'brickfill-mark.svg'));

const icons = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['favicon-48x48.png', 48],
  ['favicon-192x192.png', 192],
  ['favicon-512x512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of icons) {
  await sharp(mark, { density: Math.max(72, (72 * size) / 64) })
    .resize(size, size)
    .png()
    .toFile(path.join(publicDir, name));
  console.log(`${name} ${size}x${size}`);
}

// Social preview (1200x630): the mark and the wordmark on the Mortar background.
const ogImage = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EDE4"/>
  <rect x="0" y="600" width="1200" height="30" fill="#C2410C"/>
  <g transform="translate(130 195) scale(3.75)">
    <rect x="10" y="10" width="44" height="12" rx="3" fill="#1B2A3A" fill-opacity="0.18"/>
    <rect x="10" y="26" width="44" height="12" rx="3" fill="#1B2A3A" fill-opacity="0.18"/>
    <rect x="10" y="26" width="28" height="12" rx="3" fill="#C2410C"/>
    <rect x="10" y="42" width="44" height="12" rx="3" fill="#C2410C"/>
  </g>
  <text x="430" y="330" fill="#1B2A3A" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="120" font-weight="800" letter-spacing="-3">BrickFill</text>
  <text x="434" y="400" fill="#1B2A3A" fill-opacity="0.75" font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="32">Evidence-first catalog enrichment on Databricks</text>
</svg>`);
await sharp(ogImage).png().toFile(path.join(publicDir, 'og-image.png'));
console.log('og-image.png 1200x630');
