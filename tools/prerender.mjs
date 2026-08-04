/**
 * Prerender the case-study pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every case study keeps its whole text in a JS object (`T`) and paints it into
 * empty containers on load. That is lovely to edit and invisible to anything
 * that does not run JavaScript — which is most of what matters here: LinkedIn's
 * link preview, Slack unfurls, Bing, and Google's first (HTML-only) pass. Before
 * this script the four pages shipped ~120 characters of body text each.
 *
 * So we render each page in real Chromium, take the DOM that JS produced, and
 * write it back into the source file between markers. The result is a page that
 * is already complete in the HTML. When a browser then loads it, `render()` runs
 * exactly as before and repaints the same markup over the top — nothing changes
 * on screen, no flash, and the language switch keeps working. The baked HTML is
 * a fallback for readers that never get that far.
 *
 * The content still lives in `T`. That is the source of truth. This script is
 * the compile step:
 *
 *     npm run prerender      # after editing any T object, before committing
 *
 * It is idempotent — running it twice produces the same file.
 */

import { launchChromium } from './browser.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = [
  'repapp.html',
  'red-thread.html',
  'between-the-lines.html',
  'hospital-wayfinding.html',
];

/* The containers `render()` fills. Each is empty in the source; we bake the
   rendered markup inside it. */
const CONTAINERS = [
  { id: 'meta',    tag: 'div'     },
  { id: 'hero',    tag: 'div'     },
  { id: 'glance',  tag: 'div'     },
  { id: 'article', tag: 'article' },
  { id: 'toc',     tag: 'ol'      },
];

const START = '<!--prerendered-->';
const END   = '<!--/prerendered-->';

/* ------------------------------------------------------- source rewriting */

/**
 * Replace the contents of one element in the source HTML, in place.
 *
 * On the first run the element still holds whatever the author wrote (empty for
 * the containers, a fallback string for the `data-t` leaves) and we swap that
 * for the baked markup wrapped in markers. On later runs we simply replace what
 * sits between the markers, so re-running is a no-op when nothing changed.
 */
function replaceInner(html, openRe, tag, content, label) {
  openRe.lastIndex = 0;
  const open = openRe.exec(html);
  if (!open) throw new Error(`${label}: could not find the opening <${tag}>`);
  const from = open.index + open[0].length;
  const rest = html.slice(from);
  const baked = `${START}${content}${END}`;

  if (rest.startsWith(START)) {
    const end = rest.indexOf(END);
    if (end === -1) throw new Error(`${label}: ${START} with no ${END}`);
    return html.slice(0, from) + baked + rest.slice(end + END.length);
  }

  const close = rest.indexOf(`</${tag}>`);
  if (close === -1) throw new Error(`${label}: no closing </${tag}>`);
  /* Guard: if the existing contents nest another <tag>, `close` is the wrong
     one and we would eat real markup. Every target is either empty or a leaf,
     so this should never fire — but it is the difference between a bad run and
     a mangled source file. */
  if (new RegExp(`<${tag}[\\s>]`, 'i').test(rest.slice(0, close))) {
    throw new Error(`${label}: nested <${tag}> — refusing to guess the closing tag`);
  }
  return html.slice(0, from) + baked + rest.slice(close);
}

/* ------------------------------------------------------------------- main */

const { server, origin } = await serve(ROOT);
const browser = await launchChromium();

let changed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const file of PAGES) {
    await page.goto(`${origin}/${file}`, { waitUntil: 'networkidle' });
    /* `render()` runs at the bottom of the page's own script, so by load it is
       already done; wait on the article anyway rather than assume. */
    await page.waitForFunction(() => document.querySelector('#article section.sec'));

    const harvest = await page.evaluate(({ containers }) => {
      /* Strip everything the page added at runtime, so what we bake is the
         markup `render()` produced and nothing about one particular scroll
         position or viewport. */
      document.querySelectorAll('.reveal.in').forEach(e => e.classList.remove('in'));
      document.querySelectorAll('#toc a.on').forEach(e => e.classList.remove('on'));

      const out = { containers: {}, text: {} };
      for (const { id } of containers) out.containers[id] = document.getElementById(id).innerHTML;
      document.querySelectorAll('[data-t]').forEach(el => {
        out.text[el.dataset.t] = { html: el.innerHTML, tag: el.tagName.toLowerCase() };
      });
      return out;
    }, { containers: CONTAINERS });

    const path = join(ROOT, file);
    const before = await readFile(path, 'utf8');
    let html = before;

    for (const { id, tag } of CONTAINERS) {
      html = replaceInner(
        html,
        new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>`),
        tag, harvest.containers[id], `${file} #${id}`);
    }
    for (const [key, { html: inner, tag }] of Object.entries(harvest.text)) {
      html = replaceInner(
        html,
        new RegExp(`<${tag}\\b[^>]*\\bdata-t="${key}"[^>]*>`),
        tag, inner, `${file} [data-t="${key}"]`);
    }

    const words = harvest.containers.article.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    if (html === before) {
      console.log(`  ${file.padEnd(26)} unchanged (${words} words already baked)`);
    } else {
      await writeFile(path, html, 'utf8');
      changed++;
      console.log(`  ${file.padEnd(26)} baked ${words} words into the HTML`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(changed ? `\n${changed} page(s) rewritten — commit them.` : '\nAll pages already up to date.');
