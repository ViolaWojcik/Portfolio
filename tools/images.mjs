/**
 * Re-encode the case-study artwork as WebP: `npm run images`.
 *
 * WHY
 * ---
 * The four case studies carry 24.6 MB of PNG and JPEG between them, and most of
 * it is 3200px wide. Nothing on the site ever shows an image that large: the
 * reading column is 680px, a wide figure is 920px, and the lightbox tops out at
 * 1400px. Every visitor was downloading roughly four times the pixels their
 * screen could use.
 *
 * WHAT IT DOES
 * ------------
 * For each source image, writes a sibling `.webp` capped at MAX_W wide — enough
 * for the lightbox with headroom — and repoints the `ASSETS` entries in the HTML
 * at it. Chromium does the resampling and encoding, because it is already a
 * dependency here and ImageMagick is not.
 *
 * The originals stay in the repository. They are the masters, deleting them
 * would not shrink a clone (git keeps the history either way), and one of them
 * is still the Open Graph image for the hospital case study — link scrapers are
 * less reliable about WebP than browsers are, so `og:image` keeps pointing at a
 * PNG on purpose.
 *
 * Quality is split by what the picture is. Photographs tolerate lossy encoding
 * happily; screenshots and diagrams carry text, and text is exactly where WebP
 * artefacts show, so those get a higher setting.
 *
 * Idempotent: a `.webp` that is already newer than its source is left alone.
 */

import { launchChromium } from './browser.mjs';
import { serve } from './static-server.mjs';
import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DIRS = ['RepApp', 'red-thread', 'between-the-lines', 'hospital-wayfinding'];
const PAGES = ['repapp.html', 'red-thread.html', 'between-the-lines.html', 'hospital-wayfinding.html'];

/* The lightbox is `max-width:min(1400px,94vw)`, so 1600 covers it at 1× with
   room to spare. Beyond that the extra pixels are only ever thrown away. */
const MAX_W = 1600;

/* Photographs (jpg) hide lossy artefacts; screenshots and diagrams (png) carry
   text, which is where they show. */
const QUALITY = { photo: 0.82, graphic: 0.92 };

const force = process.argv.includes('--force');

const { server, origin } = await serve(ROOT);
const browser = await launchChromium();

let before = 0, after = 0, written = 0, skipped = 0;
const renames = new Map();          // 'dir/assets/x.png' → 'dir/assets/x.webp'

try {
  const page = await browser.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });

  for (const dir of DIRS) {
    const files = (await readdir(join(ROOT, dir, 'assets')))
      .filter(f => /\.(png|jpe?g)$/i.test(f))
      .sort();

    for (const file of files) {
      const src = join(ROOT, dir, 'assets', file);
      const out = src.replace(/\.(png|jpe?g)$/i, '.webp');
      const rel = `${dir}/assets/${file}`;
      const srcStat = await stat(src);

      renames.set(rel, rel.replace(/\.(png|jpe?g)$/i, '.webp'));
      before += srcStat.size;

      if (!force) {
        try {
          if ((await stat(out)).mtimeMs > srcStat.mtimeMs) {
            after += (await stat(out)).size; skipped++; continue;
          }
        } catch { /* not built yet */ }
      }

      const quality = extname(file).toLowerCase() === '.png' ? QUALITY.graphic : QUALITY.photo;

      const result = await page.evaluate(async ({ url, maxW, quality }) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const w = Math.min(img.naturalWidth, maxW);
        const h = Math.round(w * img.naturalHeight / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise(r => c.toBlob(r, 'image/webp', quality));
        return {
          from: [img.naturalWidth, img.naturalHeight], to: [w, h],
          bytes: [...new Uint8Array(await blob.arrayBuffer())],
        };
      }, { url: '/' + rel.split('/').map(encodeURIComponent).join('/'), maxW: MAX_W, quality });

      await writeFile(out, Buffer.from(result.bytes));
      after += result.bytes.length;
      written++;

      const pct = Math.round(100 - (result.bytes.length / srcStat.size) * 100);
      console.log(`  ${rel.padEnd(48)} ${result.from.join('×').padEnd(10)} → ${result.to.join('×').padEnd(10)} ` +
                  `${(srcStat.size / 1024).toFixed(0).padStart(5)} → ${(result.bytes.length / 1024).toFixed(0).padStart(5)} KB  (−${pct}%)`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n  ${written} written, ${skipped} already current`);
console.log(`  ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB ` +
            `(−${Math.round(100 - after / before * 100)}%)`);

/* ------------------------------------------------- repoint the ASSETS srcs */

for (const file of PAGES) {
  const path = join(ROOT, file);
  let html = await readFile(path, 'utf8');
  let n = 0;

  for (const [from, to] of renames) {
    /* Only inside an ASSETS `src:'…'`. og:image and any other reference to the
       original is deliberately left alone. */
    const re = new RegExp(`(src\\s*:\\s*')${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(')`, 'g');
    html = html.replace(re, (_, a, b) => { n++; return a + to + b; });
  }

  if (n) {
    await writeFile(path, html, 'utf8');
    console.log(`  ${file.padEnd(26)} ${n} asset src${n === 1 ? '' : 's'} repointed to .webp`);
  }
}
