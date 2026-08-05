/**
 * Build the polaroid portrait's responsive variants: `npm run portrait`.
 *
 * `my photo.png` is 1414×2000 and 1.1 MB. It is the right size for one job — the
 * Open Graph preview, where scrapers want a large image — and wildly wrong for
 * the other, which is a polaroid on the board that draws it at 182×212 CSS px.
 * The board was shipping roughly forty times the pixels it renders, and paying
 * for it in LCP.
 *
 * So the PNG stays exactly as it is for OG, and this writes small WebP copies
 * for the polaroid to pick from via srcset. Run it if the photo ever changes.
 *
 * Chromium does the resampling (via canvas), because it is already a dependency
 * here and ImageMagick/sharp are not.
 */

import { launchChromium } from './browser.mjs';
import { serve } from './static-server.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = 'my photo.png';
/* The polaroid's image box is 182 CSS px wide (204 card − 2×11 padding). Cover
   the usual device pixel ratios; height follows the source's aspect so
   object-fit: cover still has the whole frame to crop from. */
const WIDTHS = [182, 364, 546];
const QUALITY = 0.82;

const { server, origin } = await serve(ROOT);
const browser = await launchChromium();

try {
  const page = await browser.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });

  const out = await page.evaluate(async ({ src, widths, quality }) => {
    const img = new Image();
    img.src = '/' + encodeURIComponent(src);
    await img.decode();

    /* Does the alpha channel carry anything, or is it a fully opaque photo
       stored as RGBA? If it is opaque we can flatten and let WebP be lossy
       without risking a halo. */
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth; probe.height = img.naturalHeight;
    probe.getContext('2d').drawImage(img, 0, 0);
    const data = probe.getContext('2d').getImageData(0, 0, probe.width, probe.height).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) transparent++;

    const files = [];
    for (const w of widths) {
      const h = Math.round(w * img.naturalHeight / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => c.toBlob(r, 'image/webp', quality));
      files.push({ w, h, bytes: [...new Uint8Array(await blob.arrayBuffer())] });
    }
    return {
      natural: { w: img.naturalWidth, h: img.naturalHeight },
      transparentPixels: transparent,
      files,
    };
  }, { src: SOURCE, widths: WIDTHS, quality: QUALITY });

  console.log(`source ${SOURCE}: ${out.natural.w}×${out.natural.h}`);
  console.log(out.transparentPixels === 0
    ? '  alpha channel is entirely opaque — safe to flatten into lossy WebP'
    : `  WARNING: ${out.transparentPixels} pixels carry alpha; check the output`);

  for (const f of out.files) {
    const name = `my-photo-${f.w}.webp`;
    await writeFile(join(ROOT, name), Buffer.from(f.bytes));
    console.log(`  ${name.padEnd(22)} ${f.w}×${f.h}  ${(f.bytes.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  server.close();
}
