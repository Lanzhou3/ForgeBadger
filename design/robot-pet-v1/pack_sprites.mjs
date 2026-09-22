/** Pack Blender's RGBA frames using Next's existing sharp dependency. */
import { createRequire } from 'node:module';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const webRequire = createRequire(new URL('../../packages/web/package.json', import.meta.url));
const sharp = createRequire(webRequire.resolve('next/package.json'))('sharp');
const output = new URL('../../packages/web/public/pets/fb01/', import.meta.url);
await mkdir(output, { recursive: true });
const groups = { stand: ['stand', 'blink'], walk: ['walk1', 'walk2'], sit: ['sit1', 'sit2', 'sitBlink'] };
const manifest = { frameSize: 192, displaySize: 88, sheets: {} };
for (const [name, frames] of Object.entries(groups)) {
  const layers = frames.map((frame, index) => ({
    input: fileURLToPath(new URL(`frames/${frame}.png`, import.meta.url)),
    left: index * 192, top: 0,
  }));
  const destination = new URL(`${name}.webp`, output);
  await sharp({ create: { width: 192 * frames.length, height: 192, channels: 4, background: '#00000000' } })
    .composite(layers).webp({ quality: 86, alphaQuality: 100, effort: 6 }).toFile(fileURLToPath(destination));
  manifest.sheets[name] = { frames, bytes: (await stat(destination)).size, decodedBytes: 192 * 192 * 4 * frames.length };
}
await writeFile(new URL('sprite-info.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
